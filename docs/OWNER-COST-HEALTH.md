# Owner Cost & Health

The private `/cost-health` page is linked from Support **only for the configured owner**. This feature does not purchase anything, change provider limits, terminate services, or expose billing to teachers, students or other support administrators.

## Dashboard navigation

- **Overview:** reported spend, recorded-usage chart, provider watchlist, service pulse and the most urgent saved warning.
- **Providers:** select a compact row to reveal all usage meters, reading periods, connection instructions and the provider's own dashboard link. Multi-product providers show source coverage on the watchlist, not a falsely combined metric.
- **Alerts:** usage/service warnings and incomplete connections in separate sections.
- **Settings:** individual dollar warning targets, email preferences, test email and monitoring cadence.

The 1D/7D/30D chart filters actual recorded checks. The server returns the latest 48 checks, not necessarily a full range. Historical amounts do not identify their component providers or billing periods, so the chart displays independent readings rather than a continuous line, percentage growth or invented forecast. Select a reading below the plot for its amount and timestamp. Missing data remains empty, never zero. A genuine zero is still a real reading.

## Approved alert settings

Initial warning budgets: USD 15/month each for Railway, Neon, Cloudflare and Brevo. No total budget is inferred. LiveKit is excluded from the dollar budget until the owner chooses one. The email recipient is a deployment secret/configuration value; it is deliberately absent from source.

These are saved warning targets, not guaranteed active dollar monitoring. Railway can trigger dollar alerts when its workspace connection reports resource charges. The current Neon, Cloudflare and Brevo adapters do not report dollar charges: their USD 15 targets are saved for reference, while supported quota warnings remain separate. The page labels this explicitly and does not offer an overall-budget editor whose coverage cannot be met. This release is not yet a complete cross-provider billing console.

Warnings are generated at 70%, 85%, 95% and 100% of an available quota or budget. Only the highest crossed threshold is sent on a check. Threshold keys include the provider period, so subsequent refreshes do not repeat the same warning. Forecasts above an individual budget also warn. A failed provider request does not become zero usage.

## What “live” means

- The open page fetches the latest saved readings every minute and requests a provider refresh every five minutes while visible.
- Server refreshes are limited to one every five minutes across processes. Background checks default to once per hour to avoid keeping a Free Neon compute awake continuously.
- Provider reporting delay still applies. Every reading shows its check time, observation time, scope and period. The page cannot make delayed billing instantaneous.
- Unknown dollar amounts are not added as zero. A combined forecast requires complete, comparable periods and is unavailable with current partial provider coverage. Railway's separate forecast is a **resource-only straight-line estimate**, not an invoice; subscriptions, credits and taxes are excluded.
- Retrieval timestamps show when a provider response was obtained, not a guarantee that its billing data is up to the second. Missing HTTP date headers use the successful local check time.
- Cloudflare analytics are account-wide, sampled event counts, **not** invoice amounts. R2 operation totals alone cannot determine its bill. AI event counts do not determine billed neurons. Keep Cloudflare's own billable-usage alerts enabled.
- Brevo reports transactional email requests. The Free plan's published 300/day allowance is shared with marketing emails. This meter is not a complete marketing-plus-transactional send ledger.
- Video cards disclose configured LiveKit and Daily fallback rather than pretending either bill is known. Native app/older-client routing can still use Daily even with browser LiveKit selected.

## Deployment configuration

Configure only on the selected monitoring API service. Do not put these values in `EXPO_PUBLIC_*`, Git, frontend forms, screenshots or support prompts.

| Variable | Purpose |
| --- | --- |
| `COST_HEALTH_OWNER_USER_ID` | Exact existing owner account id in this database. Its current role must be admin. No default or first-admin fallback. |
| `COST_HEALTH_ALERT_EMAIL` | Owner-approved alert recipient. Only deployment administrators can change it. |
| `COST_HEALTH_ENABLED=true` | Run background checks and warning emails while the API is online. |
| `COST_HEALTH_INTERVAL_MINUTES` | Optional 15–1440; default 60. Faster polling adds database activity. |
| `COST_HEALTH_NEON_API_KEY` | Neon management API key for the named projects, not the Postgres password. Use the narrowest supported scope. |
| `COST_HEALTH_NEON_PROJECTS_JSON` | JSON array such as `[{"id":"your-staging-project-id","name":"Staging"},{"id":"your-production-project-id","name":"Production"}]`. |
| `COST_HEALTH_RAILWAY_API_TOKEN` | Workspace-capable Railway API token, not a project-only deployment token. |
| `COST_HEALTH_RAILWAY_WORKSPACE_ID` | Exact billing workspace id. Workspace use can include other projects. |
| `COST_HEALTH_CLOUDFLARE_API_TOKEN` | Cloudflare API token with Account Analytics: Read for the correct account. |
| `COST_HEALTH_CLOUDFLARE_ACCOUNT_ID` | Exact Cloudflare account id. |
| `COST_HEALTH_BREVO_API_KEY` | Optional monitoring key; otherwise reuses existing server-only `BREVO_API_KEY`. |

The integration sends read-only queries. Some providers offer broader API tokens rather than a dedicated usage-only scope: keep tokens on the server and use minimum available access. Existing `BREVO_API_KEY` / `RESEND_API_KEY` plus `EMAIL_FROM` send alerts through the app's mailer; Resend wins if both keys are configured.

Existing owner accounts can use the current private admin login during the separate operator-site migration. If an operator record exists, it must additionally be an enabled administrator and have completed the first-password change. Do not turn a shared synthetic operator into the owner to make a test pass.

## Verification and operation

1. Sign in as the configured owner and open Cost & Health from Support. Ordinary admins must not see the link and must receive HTTP 403 from the direct endpoint.
2. Press Refresh. Unconnected providers show their setup gap, never an invented dollar total.
3. Open Providers and select a row; confirm its usage belongs to the intended account/project and period.
4. Open Settings, review budgets, then Send test email. “Accepted” means accepted by the mail provider, not proof it arrived in the inbox. Tests are rate-limited to one per fifteen minutes.
5. Keep provider alerts enabled independently. Existing Railway hard limits can take services offline before an alert-only Fadko budget is reached.

### Important outage boundary

These HTTP probes check the public website and API liveness endpoints; they do not validate payments, login, database readiness, whiteboard synchronization or live media. The monitor runs inside the API, so it cannot warn during its own total outage. Use an independent uptime monitor as well. No self-repair or availability guarantee is claimed.

Hourly database writes and HTTP probes themselves use a small amount of service capacity and can wake sleeping services. Checks run only while the monitoring API is online. Failed provider calls generate email warnings; missing configuration and partial-coverage notices appear on the page, not as repeated setup emails. Recheck the coverage section after changing service variables.

Leaving the live dashboard open can keep database compute awake because private access is revalidated while readings refresh. Close it when not needed; the hourly scheduler and configured emails continue while the API is online. Railway workspace API tokens are workspace-wide, not read-only: prefer a Viewer OAuth integration or explicitly review the broader token scope before connecting it. Never repurpose the developer CLI's interactive login token.

### Durable state

Three additive tables (`owner_cost_health`, `owner_cost_health_history`, `owner_cost_health_alerts`) are created lazily. Existing account/class tables are untouched. Snapshots contain safe usage metadata, never API keys or customer evidence. History and alert records expire after 90 days. Failed email submissions are retried on subsequent checks, at most three attempts per warning with a thirty-minute delay. Provider acceptance is recorded before considering an email sent. A crash between remote acceptance and the database write can cause an at-least-once retry; do not promise exactly-once delivery.

### Official API sources

- [Neon project details, including current consumption](https://api-docs.neon.tech/reference/getproject). The separate consumption-history API is paid-plan restricted; this integration does not require it.
- [Railway API](https://docs.railway.com/integrations/api) and [Railway's own usage client](https://github.com/railwayapp/cli/blob/master/src/commands/usage.rs).
- [Cloudflare GraphQL analytics](https://developers.cloudflare.com/analytics/graphql-api/) and [R2 metrics](https://developers.cloudflare.com/r2/platform/metrics-analytics/).
- [Brevo account API](https://developers.brevo.com/reference/get-account) and [transactional reports](https://developers.brevo.com/reference/get-smtp-report).

Original deployment evidence and connection gaps belong in `.agents/worklog/2026-09-29-codex-owner-cost-health.md`; dashboard redesign verification is in `.agents/worklog/2026-09-29-codex-cost-dashboard-redesign.md`. This document alone is not proof of a live rollout.
