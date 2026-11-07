// Auto-loaded by Trigger.dev before every run (init.ts at the root of the trigger dir).
import * as Sentry from '@sentry/node'
import { tasks } from '@trigger.dev/sdk'

Sentry.init({
  dsn: process.env.TRIGGER_SENTRY_DSN,
  // Trigger.dev runs its own OpenTelemetry setup for run tracing; Sentry's default
  // integrations would register a second one, so only what's listed here is enabled.
  defaultIntegrations: false,
  integrations: [
    // gen_ai spans (model calls, tool calls, tokens, cost) from the AI SDK's `ai:telemetry`
    // channel. Metadata only: chat messages, tool inputs/outputs and the system prompt stay out of
    // Sentry. Both flags must be explicit, since the integration records content by default
    Sentry.vercelAIIntegration({ recordInputs: false, recordOutputs: false }),
  ],
  // The SDK collects all of these by default. Task code handles users' messages, files and API
  // keys, so each is opted out explicitly (genAI matches the integration's flags above)
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    genAI: { inputs: false, outputs: false },
    stackFrameVariables: false,
  },
  // Each agent turn is its own trace and the only traced work here, so keep all of them:
  // a dropped root would drop the whole turn's cost and token data
  tracesSampleRate: 1.0,
  // The AI integration reports every failed tool call as an error. Tool calls the model got wrong
  // (ToolInputError in computer-tools.ts) are expected and self-correcting, and their messages
  // carry the user's file paths, so they stay on the span's status only. Matched by name to keep
  // this file from loading the sandbox SDK
  beforeSend: (event, hint) =>
    hint.originalException instanceof Error && hint.originalException.name === 'ToolInputError'
      ? null
      : event,
})

tasks.onStartAttempt(({ ctx }) => {
  // A worker process serves one deployed version in one environment, so the run's values hold for
  // every event, span and log the process sends
  const options = Sentry.getClient()?.getOptions()
  if (options) {
    options.environment = ctx.environment.type.toLowerCase()
    options.release ??= ctx.run.version
  }
  // Attached to every log and event from this attempt, so a log line leads back to its run
  const run = {
    'trigger.task': ctx.task.id,
    'trigger.run_id': ctx.run.id,
    'trigger.attempt': ctx.attempt.number,
  }
  const scope = Sentry.getGlobalScope()
  scope.setAttributes(run)
  scope.setTags(run)
  scope.setContext('trigger', {
    runId: ctx.run.id,
    taskId: ctx.task.id,
    environment: ctx.environment.slug,
    version: ctx.run.version,
  })
  // A warm worker reuses the process for the next run; don't carry the last run's user over
  Sentry.setUser(null)
})

// Fires once a run has failed for good (after retries), not on every failed attempt.
// Payloads hold user messages, so they are not attached.
tasks.onFailure(async ({ error }) => {
  Sentry.captureException(error)
  // Flushed here too: the hook order relative to onComplete isn't guaranteed
  await Sentry.flush(2000)
})

// Logs and spans are buffered. A run can be torn down when it ends, and checkpointed while it waits
// (a chat agent idles between turns this way), so send what's buffered before either happens
const flush = async () => {
  await Sentry.flush(2000)
}
tasks.onWait(flush)
tasks.onComplete(flush)
