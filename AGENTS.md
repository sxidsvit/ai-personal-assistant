## Hono CLI

Run `npx hono --help` first, and use the CLI instead of a dev server.

## Database schema changes

Do not use Drizzle migrations (`drizzle-kit generate` / `drizzle-kit migrate`). Edit `src/db/schema.ts` and apply it with `npm run db:push`.

## Railway environment variables

When syncing environment variables to Railway (e.g. "sync environment variables" via the Railway skill/MCP), always exclude `TRIGGER_SECRET_KEY`. The local value is a dev key and must never overwrite Railway's production `TRIGGER_SECRET_KEY`. Do not set, update, or delete it on Railway unless explicitly asked to change that specific variable.

## Greptile review for security-critical changes

Whenever a change touches a security-critical layer, run a Greptile review of the local branch before considering the work done (use the `greptile-cli` skill; `greptile review --json`). Triage every finding against the actual code, fix what holds up, and re-review, following the `greploop` skill. Report any findings you rejected or deferred, with the reason.

Security-critical layers in this app:

- **Webhook ingress and verification**: `src/app.ts` routing, `src/telegram-webhook.ts`, `src/linq-webhook.ts`, and `secretMatches` / signature checks in `src/channel-gate.ts`.
- **Access gating**: `src/channel-gate.ts` (who reaches the agent) and `src/billing.ts` (Pro plan checks, Clerk Backend API calls).
- **Identity and account linking**: `src/trigger/link-account.ts` (Clerk OAuth device flow), `src/db/channel-links.ts`, and the `channelIdentifiers` table in `src/db/schema.ts`.
- **Agent tools with code execution or outbound access**: `src/trigger/computer-tools.ts` (Daytona sandbox, file transfer), `src/trigger/web-tools.ts`, and the tool wiring in `src/trigger/channel-agent.ts`.
- **Outbound messaging**: `src/trigger/channel-messengers.ts`, `src/trigger/telegram-api.ts`, `src/trigger/linq-api.ts` (who a message is sent to).
- **Secrets and config**: anything that reads, logs, or forwards API keys or tokens, plus `trigger.config.ts` and environment-variable handling.
- **Database access**: `src/db/` queries that filter by user, platform, or external ID, and any schema change affecting user or link data.

Also run the review for any new file that adds a webhook route, an auth or plan check, an agent tool, or handling of secrets, even if it isn't listed above. Changes that only edit user-facing message wording or comments in these files don't need a review.

If `greptile` isn't installed or authenticated, say so and ask the user instead of skipping the review silently.
