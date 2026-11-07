// Loaded with `node --import` before any other module so Sentry can instrument the HTTP server.
import * as Sentry from '@sentry/node'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment:
    process.env.SENTRY_ENVIRONMENT ??
    process.env.RAILWAY_ENVIRONMENT_NAME ??
    process.env.NODE_ENV ??
    'development',
  release: process.env.SENTRY_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA,
  // The SDK collects all of these by default. Webhook requests carry secret headers
  // (x-telegram-bot-api-secret-token, Linq signatures) and users' messages in their bodies, and
  // local variables hold API keys and forwarding secrets, so each is opted out explicitly.
  // Users are identified by the opaque Clerk id set in channel-gate.ts instead of their IP
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    genAI: { inputs: false, outputs: false },
    stackFrameVariables: false,
  },
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
})
