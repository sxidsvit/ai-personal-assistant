import * as Sentry from '@sentry/node'
import { Hono } from 'hono'
import { linqWebhook } from './linq-webhook.js'
import { telegramWebhook } from './telegram-webhook.js'

const app = new Hono()

// Registered first: traces each request and reports unhandled 5xx errors. The automatic
// Hono integration does the same when instrument.ts is preloaded; requests are deduplicated.
app.use(Sentry.honoMiddleware(app))

app.get('/', (c) => {
  return c.text('Hello Railway!')
})

app.route('/telegram/webhook', telegramWebhook)
app.route('/linq/webhook', linqWebhook)

export default app
