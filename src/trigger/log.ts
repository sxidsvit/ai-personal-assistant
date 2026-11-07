import * as Sentry from "@sentry/node";
import { logger } from "@trigger.dev/sdk";
import type { LogAttributes } from "../log.js";

// Structured logs for tasks: sent to Sentry Logs, where init.ts attaches the run's task, run id and
// environment to every entry, and to the Trigger.dev run log. Same attribute rules as ../log.ts:
// ids, statuses and counts only, never message text, secrets or platform handles
const defined = (attributes: LogAttributes = {}) =>
  Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined)) as Record<
    string,
    string | number | boolean
  >;

export const log = {
  info: (message: string, attributes?: LogAttributes) => {
    Sentry.logger.info(message, defined(attributes));
    logger.info(message, defined(attributes));
  },
  warn: (message: string, attributes?: LogAttributes) => {
    Sentry.logger.warn(message, defined(attributes));
    logger.warn(message, defined(attributes));
  },
  error: (message: string, attributes?: LogAttributes) => {
    Sentry.logger.error(message, defined(attributes));
    logger.error(message, defined(attributes));
  },
};
