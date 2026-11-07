import type { MessageReceivedWebhookEvent } from "@linqapp/sdk/resources/webhooks";
import * as Sentry from "@sentry/node";
import { Hono } from "hono";
import { forwardToTrigger, gateInbound, upgradeMessage } from "./channel-gate.js";
import { log } from "./log.js";
import {
  isOptedOutError,
  isOptOutKeyword,
  messageText,
  sendMessage,
  unwrapWebhook,
} from "./trigger/linq-api.js";

const FORWARD_SECRET_HEADER = "x-linq-forward-secret";

// Linq's webhook (iMessage) lands here first, and only one-to-one messages that pass the channel
// gate are forwarded to the Trigger.dev endpoint. Linq waits 10 seconds for an answer and retries
// non-2xx (except other 4xx) for 30 minutes
export const linqWebhook = new Hono().post("/", async (c) => {
  let event;
  try {
    event = unwrapWebhook(await c.req.text(), c.req.header());
  } catch {
    // Either a rotated signing secret (every message stops reaching the agent) or someone probing
    log.warn("Webhook rejected: invalid signature", { "channel.platform": "linq" });
    return c.text("Invalid signature", 401);
  }

  // Everything but an inbound one-to-one message is acknowledged so Linq doesn't redeliver it.
  // The SDK's event union doesn't narrow `data` on event_type, hence the cast
  if (event.event_type !== "message.received") {
    return c.body(null, 200);
  }
  const { data } = event as MessageReceivedWebhookEvent;
  if (data.direction !== "inbound" || data.chat.is_group) {
    return c.body(null, 200);
  }

  // STOP and the other opt-out keywords are handled by Linq, which blocks every send to the user
  // until they write again; answering them would only bounce off that block
  if (data.parts.every((part) => part.type === "text") && isOptOutKeyword(messageText(data.parts))) {
    log.info("Opt-out keyword received", {
      "channel.platform": "linq",
      "channel.event_id": event.event_id,
    });
    return c.body(null, 200);
  }

  const chatId = data.chat.id;
  let gate;
  try {
    gate = await gateInbound({
      platform: "linq",
      externalUserId: data.sender_handle.handle,
      chatId,
    });
  } catch (error) {
    // A non-2xx makes Linq redeliver, so a Clerk outage retries instead of dropping the message
    Sentry.captureException(error);
    log.error("Channel gate failed", {
      "channel.platform": "linq",
      "channel.event_id": event.event_id,
    });
    return c.text("Upstream error", 502);
  }

  log.info("Channel message gated", {
    "channel.platform": "linq",
    "channel.event_id": event.event_id,
    "channel.gate_status": gate.status,
  });

  switch (gate.status) {
    case "linking":
      return c.body(null, 200);
    case "upgrade":
      try {
        await sendMessage(chatId, upgradeMessage());
      } catch (error) {
        if (isOptedOutError(error)) return c.body(null, 200);
        Sentry.captureException(error);
        log.error("Upgrade reply failed", {
          "channel.platform": "linq",
          "channel.event_id": event.event_id,
        });
        return c.text("Upstream error", 502);
      }
      return c.body(null, 200);
    case "allowed": {
      const forwarded = await forwardToTrigger({
        platform: "linq",
        url: process.env.TRIGGER_LINQ_WEBHOOK_URL!,
        secretHeader: FORWARD_SECRET_HEADER,
        secret: process.env.TRIGGER_LINQ_WEBHOOK_SECRET!,
        body: { ...event, clerkUserId: gate.clerkUserId },
      });
      return forwarded ? c.body(null, 200) : c.text("Upstream error", 502);
    }
  }
});
