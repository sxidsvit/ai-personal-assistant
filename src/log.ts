import * as Sentry from '@sentry/node'

// Structured logs for the Hono server: sent to Sentry Logs (searchable by attribute, linked to the
// request's trace) and echoed to stdout for Railway's log view.
// Attributes are queried in Sentry, so keep them to ids, statuses and counts: never message text,
// secrets, or platform handles (a Linq handle is a phone number or email)
export type LogAttributes = Record<string, string | number | boolean | undefined>

const defined = (attributes: LogAttributes = {}) =>
  Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined)) as Record<
    string,
    string | number | boolean
  >

export const log = {
  info: (message: string, attributes?: LogAttributes) => {
    Sentry.logger.info(message, defined(attributes))
    console.log(message, defined(attributes))
  },
  warn: (message: string, attributes?: LogAttributes) => {
    Sentry.logger.warn(message, defined(attributes))
    console.warn(message, defined(attributes))
  },
  error: (message: string, attributes?: LogAttributes) => {
    Sentry.logger.error(message, defined(attributes))
    console.error(message, defined(attributes))
  },
}
