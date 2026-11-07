import { webhook, webhooks } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import type { MessageReceivedWebhookEvent } from "@linqapp/sdk/resources/webhooks";
import { channelAgent, channelSurface } from "./channel-agent.js";
import { channelFileUrls, splitMessage, toUserMessage } from "./channel-messages.js";
import { log } from "./log.js";
import {
  downloadAttachment,
  isOptedOutError,
  markRead,
  MAX_DOWNLOAD_BYTES,
  messageText,
  MAX_UPLOAD_BYTES,
  sendFile,
  sendMessage,
  startTyping,
  stopTyping,
} from "./linq-api.js";

type LinqEvent = MessageReceivedWebhookEvent & {
  // Added by the Hono webhook, which forwards only messages from iMessage users linked to Clerk
  clerkUserId?: string;
};

// The Hono webhook verifies Linq's Standard Webhooks signature, then forwards linked users'
// messages here with this endpoint's secret in a header. Linq can't call this endpoint directly:
// the body it signs doesn't carry the Clerk user id
export const linqEndpoint = webhooks.endpoint.define({
  id: "linq",
  source: webhooks.custom<LinqEvent>(
    {
      scheme: "shared-secret",
      placement: "header",
      fieldName: "x-linq-forward-secret",
      // Linq redelivers with the same event_id, so retries of one message run one turn
      idempotencyField: { from: "body", name: "event_id" },
    },
    {
      setupPrompt:
        "Set this URL as TRIGGER_LINQ_WEBHOOK_URL and the endpoint's generated secret as TRIGGER_LINQ_WEBHOOK_SECRET on the Hono server, which forwards verified Linq message.received webhooks here.",
    }
  ),
});

// iMessage has no practical length cap, but a wall of text is hard to read on a phone, so very long
// replies go out as several bubbles
const LINQ_MAX_LENGTH = 4000;

const fileUrls = channelFileUrls("linq");

const chatIdOf = (ctx: { handle?: { chatId: string }; event?: LinqEvent }) =>
  ctx.handle?.chatId ?? ctx.event!.data.chat.id;

// One durable session per Clerk user, in their one-to-one iMessage chat with the line: messages
// (text and files) become turns, replies are posted back
const linqChannel = chat.channels.custom({
  id: "linq",
  endpoint: linqEndpoint,
  // Closed sessions can't be reopened and their keys can't be reused, so changing this prefix
  // is how to start every user over with a fresh session
  key: "linq-chat-{event.clerkUserId}",
  filter:
    "event.clerkUserId != null && event.event_type == 'message.received' && event.data.direction == 'inbound' && event.data.chat.is_group != true && (event.data.parts any (type == 'text') || event.data.parts any (type == 'link') || event.data.parts any (type == 'media'))",
  inbound: (event) => {
    const { data } = event;
    const text = messageText(data.parts);
    // An iMessage can carry several files in one bubble
    const attachments = data.parts.flatMap((part) =>
      part.type === "media"
        ? [{ id: part.id, filename: part.filename, mediaType: part.mime_type, size: part.size_bytes }]
        : []
    );
    return {
      message: toUserMessage({
        platform: "linq",
        text: text || undefined,
        attachments,
        maxDownloadBytes: MAX_DOWNLOAD_BYTES,
      }),
      externalUserId: data.sender_handle.handle,
      externalMessageId: data.id,
    };
  },
  bind: (event) => ({ chatId: event.data.chat.id, clerkUserId: event.clerkUserId! }),
  download: async (url) => {
    const attachmentId = fileUrls.fromUrl(url);
    return attachmentId === null ? null : { data: await downloadAttachment(attachmentId) };
  },
  surface: (ctx) => {
    const chatId = chatIdOf(ctx);
    return channelSurface({
      clerkUserId: ctx.handle?.clerkUserId ?? ctx.event!.clerkUserId!,
      maxSendBytes: MAX_UPLOAD_BYTES,
      loadAttachment: downloadAttachment,
      sendFile: async (file, caption) => {
        await sendFile(chatId, file, caption);
      },
    });
  },
  // Read receipt and typing bubble while the assistant works, like a person replying
  lifecycle: async (state, ctx) => {
    const chatId = chatIdOf(ctx);
    if (state === "working") {
      await Promise.all([markRead(chatId), startTyping(chatId)]);
    } else if (state === "idle" || state === "closed") {
      await stopTyping(chatId);
    }
  },
  outbound: (reply) => (reply.text ? { text: reply.text } : null),
  send: async (message, ctx) => {
    const chatId = chatIdOf(ctx);
    let messageId = "";
    try {
      for (const chunk of splitMessage(message.text, LINQ_MAX_LENGTH)) {
        messageId = await sendMessage(chatId, chunk);
      }
    } catch (error) {
      // The user texted STOP mid-turn: Linq blocks every send until they write again. Retrying,
      // or sending from another line, would break that, so the reply is dropped
      if (!isOptedOutError(error)) throw error;
      log.warn("Reply dropped: recipient opted out", { "channel.platform": "linq" });
    }
    return { ref: messageId };
  },
  errorMessage: "Sorry, something went wrong. Please try again.",
});

export const linqAgent = channelAgent({
  id: "linq-agent",
  channel: linqChannel,
  platformName: "iMessage",
});

// iMessage app cards and App Clips have no text or file to work with; say so instead of silently
// dropping them. Linq sends either one as the message's only part
export const linqUnsupportedMessage = webhook({
  id: "linq-unsupported-message",
  endpoint: linqEndpoint,
  filter:
    "event.clerkUserId != null && event.event_type == 'message.received' && event.data.direction == 'inbound' && event.data.chat.is_group != true && (event.data.parts all (type == 'imessage_app') || event.data.parts all (type == 'app_clip'))",
  onEvent: async ({ event }) => {
    log.info("Unsupported message type", {
      "channel.platform": "linq",
      "channel.event_id": event.event_id,
    });
    try {
      await sendMessage(
        event.data.chat.id,
        "I can read text, photos, documents, audio and video, but not this kind of message."
      );
    } catch (error) {
      if (!isOptedOutError(error)) throw error;
    }
  },
});
