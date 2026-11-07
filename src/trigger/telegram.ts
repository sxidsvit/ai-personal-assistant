import { webhook, webhooks } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import { channelAgent, channelSurface } from "./channel-agent.js";
import { log } from "./log.js";
import {
  channelFileUrls,
  splitMessage,
  toUserMessage,
  type InboundAttachment,
} from "./channel-messages.js";
import {
  downloadFile,
  MAX_DOWNLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  sendFile,
  sendMessage,
} from "./telegram-api.js";

type TelegramFile = {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

type TelegramMessage = {
  message_id: number;
  chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
  from?: { id: number };
  text?: string;
  caption?: string;
  document?: TelegramFile;
  // The same photo in increasing sizes
  photo?: (TelegramFile & { width: number; height: number })[];
  audio?: TelegramFile;
  voice?: TelegramFile;
  video?: TelegramFile;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  // Added by the Hono webhook, which forwards only updates from Telegram users linked to Clerk
  clerkUserId?: string;
};

// The Hono webhook forwards linked users' updates here with this endpoint's secret in the header
// Telegram itself uses, so the endpoint also keeps accepting Telegram directly until it is switched
export const telegramEndpoint = webhooks.endpoint.define({
  id: "telegram",
  source: webhooks.custom<TelegramUpdate>(
    {
      scheme: "shared-secret",
      placement: "header",
      fieldName: "x-telegram-bot-api-secret-token",
      idempotencyField: { from: "body", name: "update_id" },
    },
    {
      setupPrompt:
        "Register the URL with the Telegram Bot API setWebhook method, passing the endpoint's generated secret as secret_token.",
    }
  ),
});

// Telegram rejects messages over 4096 characters
const TELEGRAM_MAX_LENGTH = 4096;

// A Telegram message carries at most one file; albums arrive as one message per item
const attachmentOf = (message: TelegramMessage): InboundAttachment | undefined => {
  const id = message.message_id;
  const fromFile = (file: TelegramFile, fallbackName: string, fallbackType: string) => ({
    id: file.file_id,
    filename: file.file_name ?? fallbackName,
    mediaType: file.mime_type ?? fallbackType,
    size: file.file_size,
  });
  if (message.document) {
    return fromFile(message.document, `file-${id}`, "application/octet-stream");
  }
  if (message.photo?.length) {
    return fromFile(message.photo.at(-1)!, `photo-${id}.jpg`, "image/jpeg");
  }
  if (message.audio) return fromFile(message.audio, `audio-${id}.mp3`, "audio/mpeg");
  if (message.voice) return fromFile(message.voice, `voice-${id}.ogg`, "audio/ogg");
  if (message.video) return fromFile(message.video, `video-${id}.mp4`, "video/mp4");
};

const fileUrls = channelFileUrls("telegram");

// One durable session per Clerk user, in their private chat: messages (text and files) become turns,
// replies are posted back
const telegramChannel = chat.channels.custom({
  id: "telegram",
  endpoint: telegramEndpoint,
  // Closed sessions can't be reopened and their keys can't be reused, so changing this prefix
  // is how to start every user over with a fresh session
  key: "telegram-chat-{event.clerkUserId}",
  filter:
    "event.clerkUserId != null && event.message.chat.type == 'private' && (event.message.text != null || event.message.caption != null || event.message.document != null || event.message.photo != null || event.message.audio != null || event.message.voice != null || event.message.video != null)",
  inbound: (update) => {
    const message = update.message!;
    const attachment = attachmentOf(message);
    return {
      message: toUserMessage({
        platform: "telegram",
        text: message.text ?? message.caption,
        attachments: attachment ? [attachment] : [],
        maxDownloadBytes: MAX_DOWNLOAD_BYTES,
      }),
      externalUserId: message.from && String(message.from.id),
      externalMessageId: String(message.message_id),
    };
  },
  bind: (update) => ({ chatId: update.message!.chat.id, clerkUserId: update.clerkUserId! }),
  download: async (url) => {
    const fileId = fileUrls.fromUrl(url);
    return fileId === null ? null : { data: await downloadFile(fileId) };
  },
  surface: (ctx) => {
    const chatId = ctx.handle?.chatId ?? ctx.event!.message!.chat.id;
    return channelSurface({
      clerkUserId: ctx.handle?.clerkUserId ?? ctx.event!.clerkUserId!,
      maxSendBytes: MAX_UPLOAD_BYTES,
      loadAttachment: downloadFile,
      sendFile: async (file, caption) => {
        await sendFile(chatId, file, caption);
      },
    });
  },
  outbound: (reply) => (reply.text ? { text: reply.text } : null),
  send: async (message, ctx) => {
    const chatId = ctx.handle?.chatId ?? ctx.event!.message!.chat.id;
    let messageId = 0;
    for (const chunk of splitMessage(message.text, TELEGRAM_MAX_LENGTH)) {
      messageId = await sendMessage(chatId, chunk);
    }
    return { ref: String(messageId) };
  },
  errorMessage: "Sorry, something went wrong. Please try again.",
});

export const telegramAgent = channelAgent({
  id: "telegram-agent",
  channel: telegramChannel,
  platformName: "Telegram",
});

// Stickers, locations, contacts and the like have no text or file to work with; say so instead of
// silently dropping them
export const telegramUnsupportedMessage = webhook({
  id: "telegram-unsupported-message",
  endpoint: telegramEndpoint,
  filter:
    "event.clerkUserId != null && event.message.chat.type == 'private' && event.message.text == null && event.message.caption == null && event.message.document == null && event.message.photo == null && event.message.audio == null && event.message.voice == null && event.message.video == null",
  onEvent: async ({ event }) => {
    log.info("Unsupported message type", {
      "channel.platform": "telegram",
      "channel.event_id": event.update_id,
    });
    await sendMessage(
      event.message!.chat.id,
      "I can read text, photos, documents, audio and video, but not this kind of message."
    );
  },
});
