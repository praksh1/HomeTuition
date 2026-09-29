# Owner-only Cost & Health

- Date: 2026-09-29
- Agent: Codex with provider-adapter, frontend and integration-test agents
- Branch: codex/owner-cost-health-release (isolated production release); source codex/owner-cost-health
- Base commit: a4d4ba9 production; source 36e4a39 Preview
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

- Release: 753 API unit tests, 573 app unit tests, API/app typechecks, API bundle and design lint pass. Rebuilding shared library declarations corrected initially stale local type output; no source change was needed.
- Cost-specific: 19 policy/adapter tests, 5 app helper tests. Isolated actual-HTTP/PostgreSQL suite passed 10/10 against verified staging in both source and release checkouts. Disposable schemas were removed; no production customer records or real emails were used by those tests.
- Mocked browser checks passed 32/32 on the source operator build at 390px/1440px. Both screenshots inspected. Actual production app bundle still needs its own render check before publishing.
- Live Railway metadata and names-only configuration inspected. Both Preview and Production select LiveKit; Brevo is configured. No provider secret values printed.
- Live read-only Brevo adapter returned today's transactional requests. Railway's actual workspace usage GraphQL fields were checked through its authenticated CLI; no monitoring token was created.
- Nonsecret owner configuration was saved only on the exact production API service, using skip-deploys: existing owner id, approved alert email, hourly monitoring and known account/workspace ids. Four budgets default to USD 15; no total or LiveKit budget. No existing provider hard cap changed.

## Problems and surprises

- Ordinary shell helper fails, but scoped elevated shell runs work. Browser helper still cannot initialize (missing kernel-assets path), so the signed-in Neon/Cloudflare tabs cannot currently be controlled.
- New provider-specific read-only credentials are not present in Railway. An existing database connection is not a Neon management API key.
- Production frontend local Metro build failed twice resolving es-object-atoms despite a valid lockfile, existing files and successful Node resolution. Repairing local dependencies before release; never substitute the newer Preview frontend.
- Successful API responses without HTTP Date originally suppressed alerts; fixed to use a retrieval timestamp, with a regression test. Railway projections are explicitly local resource-only extrapolation, not provider invoices.
- Railway's API token mutation supports name/workspace only, no read-only scope. Do not silently mint an administrator-equivalent workspace token. Viewer OAuth requires a separate consent integration.

## Fabrications found

None introduced. The page explicitly distinguishes incomplete coverage and provider estimates from invoices.

## Deliberately not changed

Billing plans, provider hard limits, LiveKit budget, customer learning/payment features, unrelated Preview changes and user-owned untracked audit/build output.

## Remaining risks / next pickup point

Finish production bundle/render checks, release deployment and a real test email. Provider credentials remain a separate setup gap. Cloudflare analytics are not dollar billing even when connected; unknown costs remain unknown. Do not claim all providers are connected or continuous independent outage monitoring until verified.
