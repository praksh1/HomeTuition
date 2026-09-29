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

- Initial nine policy tests pass, covering access, settings bounds, missing/stale values, quota periods, projections and family budgets.
- Live Railway metadata and names-only configuration inspected. Both Preview and Production select LiveKit; Brevo is configured. No provider secret values printed.

## Problems and surprises

- Ordinary shell helper fails, but scoped elevated shell runs work. Browser helper still cannot initialize (missing kernel-assets path), so the signed-in Neon/Cloudflare tabs cannot currently be controlled.
- New provider-specific read-only credentials are not present in Railway. An existing database connection is not a Neon management API key.

## Fabrications found

None introduced. The page explicitly distinguishes incomplete coverage and provider estimates from invoices.

## Deliberately not changed

Billing plans, provider hard limits, LiveKit budget, customer learning/payment features, unrelated Preview changes and user-owned untracked audit/build output.

## Remaining risks / next pickup point

Finish provider and database integration tests, visual checks, explicit credential setup, release deployment and a real test email. Do not claim all providers are connected or continuous independent outage monitoring until verified.
