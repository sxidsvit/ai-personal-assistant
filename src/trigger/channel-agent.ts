import * as Sentry from "@sentry/node";
import { chat, defaultStorage, type AnyChannelConnector } from "@trigger.dev/sdk/ai";
import { stepCountIs } from "ai";
import { log } from "./log.js";
import { chatModel } from "./model.js";
import { computerTools, computerToolsInstructions, type ComputerSurface } from "./computer-tools.js";
import { webTools, webToolsInstructions } from "./web-tools.js";

const MODEL_ID = "claude-opus-5-5";

// What a channel's surface() hands the agent: the computer tools' surface, plus who the chat
// belongs to so errors, logs and AI spans can be attributed to the user
export type ChannelSurface = ComputerSurface & { clerkUserId: string };

// The sandbox belongs to the Clerk user, so the same files are there whichever platform they
// write from
export const channelSurface = ({
  clerkUserId,
  ...surface
}: Omit<ComputerSurface, "sandboxName"> & { clerkUserId: string }): ChannelSurface => ({
  sandboxName: `user-${clerkUserId}`,
  clerkUserId,
  ...surface,
});

// The assistant on one chat platform: every channel gets the same model, tools and instructions,
// and only says which platform it is chatting over
export const channelAgent = <TId extends string>({
  id,
  channel,
  platformName,
}: {
  id: TId;
  channel: AnyChannelConnector;
  // How the platform is named to the model, e.g. "Telegram" or "iMessage"
  platformName: string;
}) =>
  chat.agent({
    id,
    channels: [channel],
    // Turns that work on files run many tool calls, well past the project's 5 minute default
    maxDuration: 30 * 60,
    // The platform's transcript snapshot: a run that boots after the previous one ended
    // loads the conversation from it, so the agent remembers the chat without a database
    storage: defaultStorage,
    tools: { ...webTools, ...computerTools },
    run: async ({ messages, tools, signal, streamText, channel: surface }) => {
      const clerkUserId = (surface as Partial<ChannelSurface> | undefined)?.clerkUserId;
      // Opaque Clerk id only: shows up as the user on this turn's errors, logs and AI spans
      if (clerkUserId) Sentry.setUser({ id: clerkUserId });
      const attributes = {
        "gen_ai.agent.name": id,
        "gen_ai.request.model": MODEL_ID,
        "channel.platform": platformName,
      };

      return streamText({
        model: chatModel(MODEL_ID),
        // Names the agent on its gen_ai spans in Sentry. Content recording is decided by the
        // Sentry integration in init.ts, so the Trigger.dev run view still shows full turns
        experimental_telemetry: { isEnabled: true, functionId: id },
        // Set per turn so relative requests like "tonight" or "this weekend" resolve correctly
        system: [
          `You are a helpful, concise personal assistant chatting over ${platformName}.`,
          `Today is ${new Date().toUTCString()}.`,
          webToolsInstructions,
          computerToolsInstructions,
        ].join("\n\n"),
        messages,
        tools,
        abortSignal: signal,
        stopWhen: stepCountIs(40),
        // One record per turn, so token use and cost per user stay complete even where traces
        // aren't kept. Hitting the step cap (finish reason "tool-calls" at 40 steps) means the
        // turn was cut short
        onFinish: ({ totalUsage, steps, finishReason }) => {
          log.info("Agent turn finished", {
            ...attributes,
            "gen_ai.response.finish_reasons": finishReason,
            "gen_ai.usage.input_tokens": totalUsage.inputTokens,
            "gen_ai.usage.input_tokens.cached": totalUsage.inputTokenDetails?.cacheReadTokens,
            "gen_ai.usage.output_tokens": totalUsage.outputTokens,
            "agent.steps": steps.length,
            "agent.tool_calls": steps.reduce((count, step) => count + step.toolCalls.length, 0),
          });
        },
        // A turn that errors mid-stream (model API failure, rate limit) doesn't fail the run: the
        // user just gets the channel's error message. Report it so it isn't silent
        onError: ({ error }) => {
          Sentry.captureException(error, { tags: { "gen_ai.agent.name": id } });
          log.error("Agent turn failed", attributes);
        },
      });
    },
  });
