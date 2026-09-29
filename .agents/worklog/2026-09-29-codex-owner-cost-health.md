# Owner-only Cost & Health

- Date: 2026-09-29
- Agent: Codex with provider-adapter, frontend and integration-test agents
- Branch: codex/owner-cost-health
- Base commit: 36e4a39
- Status: in progress

## Requested

Build a private owner-only page for live provider usage, budget, projected spend, warnings and email alerts. Owner approved USD 15/month per Railway, Neon, Cloudflare and Brevo, excluding LiveKit for now. The alert recipient is configured privately at deployment, not stored in source. No purchases or service shutdowns.

## Changed

Additive cost monitoring tables; exact-account server authorization; bounded provider adapters; private dashboard; per-provider budgets; durable threshold-email deduplication; hourly background job and five-minute minimum manual/provider refresh.

## Decisions and assumptions

- No total budget inferred from individual provider budgets. No provider hard caps changed. A warning cannot guarantee spending never exceeds USD 15.
- Unknown cost/usage remains unavailable, never zero. Partial readings do not become a complete monthly forecast.
- Billing/usage timings come from providers; no promise of instantaneous billing. Monitoring is opt-in on the existing API, with an explicit limitation that it cannot report its own outage.
- Explicit deployment owner user id plus current server-side admin checks; no first-admin assumption. Issued operator accounts also require administrator status, an enabled account and completed first-use password.
- Production's existing owner admin matches the approved alert email. Staging only has a non-administrator shared test operator; it is not silently promoted to owner.

## Verification

- Release: 754 API unit tests, 574 app unit tests, API/app typechecks, API bundle and design lint pass. Rebuilding shared library declarations corrected initially stale local type output; no source change was needed.
- Cost-specific: 20 policy/adapter tests, 6 app helper tests. Isolated actual-HTTP/PostgreSQL suite passed 10/10 against verified staging in both source and release checkouts. Disposable schemas were removed; no production customer records or real emails were used by those tests.
- Mocked browser checks passed 32/32 on the source operator build at 390px/1440px. Both screenshots inspected. Actual production app bundle still needs its own render check before publishing.
- Live Railway metadata and names-only configuration inspected. Both Preview and Production select LiveKit; Brevo is configured. No provider secret values printed.
- Live read-only Brevo adapter returned today's transactional requests. Railway's actual workspace usage GraphQL fields were checked through its authenticated CLI; no monitoring token was created.
- Nonsecret owner configuration was saved only on the exact production API service, using skip-deploys: existing owner id, approved alert email, hourly monitoring and known account/workspace ids. Four budgets default to USD 15; no total or LiveKit budget. No existing provider hard cap changed.
- Production API deployment `235cbe6c-de26-4697-a740-92c6784d1fbb` reached SUCCESS. Live smoke verified anonymous rejection, configured-owner access, private no-store responses, the four approved budgets, no total/LiveKit budget, and the enabled hourly scheduler. Production/Preview web and API liveness checks returned healthy on this check; this is not an end-to-end availability guarantee.
- One labelled test email to the approved recipient was accepted by the configured mail provider. Inbox delivery is not verified. Brevo transactional usage is connected; Neon, Railway and Cloudflare are not connected. No API credentials were exposed or invented.

## Problems and surprises

- Ordinary shell helper fails, but scoped elevated shell runs work. Browser helper still cannot initialize (missing kernel-assets path), so the signed-in Neon/Cloudflare tabs cannot currently be controlled.
- New provider-specific read-only credentials are not present in Railway. An existing database connection is not a Neon management API key.
- Production frontend local Metro build failed twice resolving es-object-atoms despite a valid lockfile, existing files and successful Node resolution. Repairing local dependencies before release; never substitute the newer Preview frontend.
- Successful API responses without HTTP Date originally suppressed alerts; fixed to use a retrieval timestamp, with a regression test. Railway projections are explicitly local resource-only extrapolation, not provider invoices.
- Railway's API token mutation supports name/workspace only, no read-only scope. Do not silently mint an administrator-equivalent workspace token. Viewer OAuth requires a separate consent integration.
- Final review removed the optional overall-budget editor because current partial dollar coverage cannot satisfy it. Non-Railway dollar targets are explicitly saved-for-reference, not active dollar alerts. Available Neon/Brevo allowance warnings remain independent; Railway resource-dollar warnings work with incomplete overall coverage.
- Added CI gates for the actual-HTTP cost tests and synthetic owner-screen checks. CI database mode is explicitly opt-in and accepts only the job's exact loopback database, with no query-string overrides. Syntax/diff checks and five unsafe-configuration rejection checks pass; positive loopback execution remains for CI.

## Fabrications found

None introduced. The page explicitly distinguishes incomplete coverage and provider estimates from invoices.

## Deliberately not changed

Billing plans, provider hard limits, LiveKit budget, customer learning/payment features, unrelated Preview changes and user-owned untracked audit/build output.

## Remaining risks / next pickup point

Finish the production frontend bundle/render checks and website release. The backend and one test-email submission are verified live. Provider credentials remain a separate setup gap: the browser helper still fails before opening its signed-in surfaces, and Railway's workspace API key is broader than read-only. Cloudflare analytics are not dollar billing even when connected; unknown costs remain unknown. Do not claim all providers are connected or continuous independent outage monitoring until verified.
