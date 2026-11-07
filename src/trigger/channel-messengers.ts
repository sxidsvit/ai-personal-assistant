import type { Platform } from "../db/schema.js";
import * as linq from "./linq-api.js";
import * as telegram from "./telegram-api.js";

// Plain-text sends to a chat on each platform, for flows that run outside a channel's agent, such as
// account linking. Chat ids travel as strings so one task payload fits every platform. Adding a
// platform to PLATFORMS makes this record fail to compile until it has an entry
export const sendChannelText: Record<Platform, (chatId: string, text: string) => Promise<unknown>> = {
  telegram: (chatId, text) => telegram.sendMessage(Number(chatId), text),
  linq: (chatId, text) => linq.sendMessage(chatId, text),
};
