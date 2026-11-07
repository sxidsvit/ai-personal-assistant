import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Every chat platform the assistant is reachable on. `linq` is iMessage through Linq
export const PLATFORMS = ["telegram", "linq"] as const;
export type Platform = (typeof PLATFORMS)[number];

// Links a user's identity on a chat platform to their Clerk user, so inbound messages
// can be scoped to (and rejected for anyone but) a linked account
export const channelIdentifiers = pgTable(
  "channel_identifiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    // The platform's own user id: Telegram's `from.id`, or the iMessage sender handle (an E.164
    // phone number or an Apple ID email) for Linq
    externalUserId: text("external_user_id").notNull(),
    clerkUserId: text("clerk_user_id").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("channel_identifiers_platform_external_user_id_idx").on(
      table.platform,
      table.externalUserId
    ),
  ]
);

export type ChannelIdentifier = typeof channelIdentifiers.$inferSelect;
export type NewChannelIdentifier = typeof channelIdentifiers.$inferInsert;
