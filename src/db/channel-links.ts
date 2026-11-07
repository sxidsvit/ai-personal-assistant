import { and, eq } from "drizzle-orm";
import { db } from "./index.js";
import { channelIdentifiers, type Platform } from "./schema.js";

export const findChannelLink = (platform: Platform, externalUserId: string) =>
  db.query.channelIdentifiers.findFirst({
    where: and(
      eq(channelIdentifiers.platform, platform),
      eq(channelIdentifiers.externalUserId, externalUserId)
    ),
  });

// One account-linking run per unlinked platform user at a time, so repeated messages while a code
// is still valid don't each start a new flow
export const linkIdempotencyKey = (platform: Platform, externalUserId: string) =>
  `${platform}-link-${externalUserId}`;
