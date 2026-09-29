# Owner-only Cost & Health

- Date: 2026-09-29
- Agent: Codex with provider-adapter, frontend and integration-test agents
- Branch: codex/owner-cost-health-release (isolated production release); source codex/owner-cost-health
- Base commit: a4d4ba9 production; source 36e4a39 Preview
- Status: released to Production; provider credential connections incomplete

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
- Initial mocked browser checks passed 32/32 on the source operator build. Final actual production app bundle passed 38/38 mocked browser checks at 390px/1440px; top/details screenshots inspected at both widths. The production-targeted export verifies the correct Railway API and Fadko identity.
- Live Railway metadata and names-only configuration inspected. Both Preview and Production select LiveKit; Brevo is configured. No provider secret values printed.
- Live read-only Brevo adapter returned today's transactional requests. Railway's actual workspace usage GraphQL fields were checked through its authenticated CLI; no monitoring token was created.
- Nonsecret owner configuration was saved only on the exact production API service, using skip-deploys: existing owner id, approved alert email, hourly monitoring and known account/workspace ids. Four budgets default to USD 15; no total or LiveKit budget. No existing provider hard cap changed.
- Production API deployment `235cbe6c-de26-4697-a740-92c6784d1fbb` reached SUCCESS. Live smoke verified anonymous rejection, configured-owner access, private no-store responses, the four approved budgets, no total/LiveKit budget, and the enabled hourly scheduler. Production/Preview web and API liveness checks returned healthy on this check; this is not an end-to-end availability guarantee.
- One labelled test email to the approved recipient was accepted by the configured mail provider. Inbox delivery is not verified. Brevo transactional usage is connected; Neon, Railway and Cloudflare are not connected. No API credentials were exposed or invented.
- Production website version `ba288a63-e87a-4cf2-82df-d7d22552a465` deployed the verified build from `946c8e0` on the existing `hometuition` Worker. `scripts/verify-owner-cost-health.mjs` confirmed `/cost-health` serves all three exact local bundle hashes, contains the correct production API and unavailable-dollar-alert labels, and the live anonymous data endpoint rejects access. No unrelated Preview features were promoted.

## Problems and surprises

- Ordinary shell helper fails, but scoped elevated shell runs work. Browser helper still cannot initialize (missing kernel-assets path), so the signed-in Neon/Cloudflare tabs cannot currently be controlled.
- New provider-specific read-only credentials are not present in Railway. An existing database connection is not a Neon management API key.
- Production frontend local Metro initially failed to resolve/hash es-object-atoms despite installed files. The pnpm package directory has OneDrive reparse metadata; an explicit Windows watch root and narrow default-first resolver fallback for that exact import fixed the full export. This workaround is tied to the current locked object.assign package and should be revisited with dependency upgrades. No newer Preview frontend was substituted.
- Successful API responses without HTTP Date originally suppressed alerts; fixed to use a retrieval timestamp, with a regression test. Railway projections are explicitly local resource-only extrapolation, not provider invoices.
- Railway's API token mutation supports name/workspace only, no read-only scope. Do not silently mint an administrator-equivalent workspace token. Viewer OAuth requires a separate consent integration.
- Final review removed the optional overall-budget editor because current partial dollar coverage cannot satisfy it. Non-Railway dollar targets are explicitly saved-for-reference, not active dollar alerts. Available Neon/Brevo allowance warnings remain independent; Railway resource-dollar warnings work with incomplete overall coverage.
- Added CI gates for the actual-HTTP cost tests and synthetic owner-screen checks. CI database mode is explicitly opt-in and accepts only the job's exact loopback database, with no query-string overrides. Syntax/diff checks and five unsafe-configuration rejection checks pass; positive loopback execution remains for CI.

## Fabrications found

None introduced. The page explicitly distinguishes incomplete coverage and provider estimates from invoices.

## Deliberately not changed

Billing plans, provider hard limits, LiveKit budget, customer learning/payment features, unrelated Preview changes and user-owned untracked audit/build output.

## Remaining risks / next pickup point

The backend, website, owner privacy checks and one test-email submission are verified live. Provider credentials remain a blocking setup gap: the browser helper still fails before opening its signed-in surfaces, and Railway's workspace API key is broader than read-only. Restore provider-browser access or use securely entered dedicated credentials before claiming Neon/Railway/Cloudflare live coverage. Cloudflare analytics are not dollar billing even when connected; unknown costs remain unknown. No total-cost forecast is currently available. The app's hourly scheduler runs while the API is online; that is separate from whether a Codex turn is running. Keep independent provider alerts enabled.

Latest full production workflow on pre-feature `a4d4ba9` had a pre-existing failure in its app-against-server gate; do not report that workflow as passing. Cost-specific local/live checks above passed. The new CI gates still need their positive loopback execution on the next CI run.

## Post-release source synchronization

Production-only release was pushed to `main` as `e3ce313`. CI run `36629395693` passed package typechecks and the new actual-HTTP cost suite against its throwaway Postgres; the broader workflow was still running at the last check. The verified cost changes and tests were also carried back to `codex/owner-cost-health` without promoting its unrelated Preview features. Source app typecheck passed; existing user-owned untracked audit directories remain untouched.

Railway's main-triggered deployment `0b939595-4e1b-4610-9b7c-2efefc8907d9` subsequently reached SUCCESS. A second live smoke at 20:59 UTC reconfirmed exact-owner access, private responses, four USD 15 targets, active scheduling and healthy liveness checks; no second test email was sent. The public site again matched all three verified bundle hashes. Provider connection gaps remain unchanged.
