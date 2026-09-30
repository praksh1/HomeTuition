# Production regression release and live make-up workflow

- Date: 2026-09-30
- Agent: codex
- Branch: codex/preview-journey-fixes-sep29; production candidate codex/production-journey-fixes-sep30
- Base commit: Preview 7d3b070a; Production f9b0506f3d424e4aeaf0f86366eab4bfa8722432
- Status: in progress

## Requested

Promote the verified Preview regression fixes to Production and complete real make-up request, assignment, quota-display and original-payment-hold workflow.

## Changed

Implemented private participant and operator make-up workspaces, original-lesson deep links, server-authoritative allowance display, Nepal-time date offers, request/offer/accept/withdraw decisions, explicit human evidence acknowledgment, in-app updates, original-receipt replacement details and accurate held totals. Transactional routes hold the original allocation, prevent duplicate accepted replacements and block zero-price replacement access through generic paid/free routes. Confirmed delivery starts a fresh 48-hour clock; missed replacements require human review. Feature pause retains read-only history and durable obligations.

## Decisions and assumptions

Use the owner's approved two-per-paid-month / ceil(purchased short-course lessons / 10), cap-three, no-rollover policy. No purchases, automatic refunds or bans. Confirmed teacher non-delivery does not consume courtesy allowance. No second payment or duplicate earning. AI does not confirm delivery.

## Verification

Live Railway Production deployment b339abdd-a755-44f9-96e4-5b2cc1308b8d is SUCCESS with metadata commit f9b0506f3d424e4aeaf0f86366eab4bfa8722432 on main. Remote main matches. Existing Preview fixes were verified in the prior task.

Final local checks: API and app typecheck, 631 app unit tests, 874 API unit tests, API build and unchanged design baseline passed. The make-up browser suite passed 66 assertions at 320/390/1440 pixels, with Nepal and Chicago browser timezones, read-only paused records, participant request context and ambiguous retry identity. Earlier class-home (50) and teaching-billing (42) browser gates passed. The final Preview export verifies all 130 emitted JavaScript chunks against the exact staging API.

Actual isolated PostgreSQL 16 run 36747810047 passed all 100 make-up checks, including concurrent allowance requests, nine acceptance retries, refund/acceptance races, both deterministic advisory/user-row lock regressions, exact refund-backed seat revocation, forbidden seat identity/resurrection writes, original-payment settlement, account closure blockers and operator restrictions. The downstream older program fixture then failed its current mandatory profile requirement; repairing only synthetic photo/phone/verification setup while preserving negative onboarding cases. Full CI must be green before activation.

Read-only readiness diagnostics passed for explicitly selected Preview and Production Railway services: all booking/session/payment dependencies and CREATE privilege exist; all three new make-up tables are absent, not partially installed. Added a tightly scoped live-smoke helper which uses existing clearly synthetic staging roles and prints only response counts, never credentials or user details; it makes no booking/payment/request/ticket/document actions.

The separate regression release is deployed: source 4bfb7e979c0f08eae5a88de5393deccc597a05f8, Railway 0b9743c5-08a5-44e2-bf90-3394d0f15651, Worker 5aa6aa8b-c716-4eef-8c00-2fe0c3d49e03. Live readiness, exact 129-bundle hashes and owner-page privacy checks passed. The narrow follow-on Production make-up promotion preserves that dashboard and does not activate unrelated identity/closure features.

## Problems and surprises

Production and Preview have divergent histories: 299 changed files, including a premium Production owner cost dashboard which a blanket Preview merge would overwrite. Construct a reviewed candidate preserving that dashboard and feature flags. Bundled git log stalled twice; full Git for Windows works. No local PostgreSQL/Docker executable found; use disposable CI PostgreSQL, never shared Preview as destructive fixture.

Capacity interruptions required agent retries. Deep review found alternate admin read-path authorization bypass, fulfilled replacement cases blocking account closure after payout, ignored stored policy snapshots, acceptance retries rejected after later state changes, and partial make-up storage being treated as no history. These were repaired with targeted regressions; PostgreSQL execution still must verify transaction/catalog behavior. Initial browser screenshots caught stale closing-modal titles and device-local rather than Nepal times; both repaired and reverified. Initial browser bundling could not parse the native time picker; test-only native boundary uses the established fixture alias, not a production dependency change.

## Retry audit continuation

The new real PostgreSQL make-up suite passes 108 checks, including eight reopening eligibility cases; Programs passes 608. Older downstream fixtures were updated to provide required synthetic profile metadata, expect suspended private-editor denial, verify participant-only receipt/fee arithmetic and require refunded-seat revocation rather than retained access. Negative privacy/onboarding checks remain intact; no runtime guard was relaxed. Production uses a narrow separately tested variant and preserves its owner dashboard and private-ID signer.

Preview CI 36753508070 at 6af375c3 is checking the remaining downstream suites. Final review is hardening ordinary-booking interval and amount checks against a concurrent teacher edit before activation. Synthetic-role read smoke preflight passes for both services; the Production fallback proves only repository demo seed credentials in memory. No live bookings, payments, tickets, documents or participant accounts were mutated by these diagnostics.

## Exact-source gate follow-up

- Preview 54baa1e4 / CI 36764632199 passed all 145 new PostgreSQL make-up checks. Published fixture version 1 matches snapshot version 1; runtime validation remains strict. Following public catalog pagination exposed incomplete synthetic publication stubs from approved race-test teachers, not a shared/live database write. Cleanup archives only exact tracked local-disposable fixture program IDs after API shutdown; all financial evidence remains intact.
- Production 51c8a259 / CI 36764603174 passed every server/database gate, then mobile test diagnostics proved a date-picker dismissal/scroll race in coordinate sampling. Both browser scripts now await actual picker detachment and stable hit-tested geometry before trusted input, retaining original action timeouts and assertions. No frontend runtime change was made.
- Independent audit additionally found a financial support-ticket FK/original-payment lock inversion; the narrow payment-first correction and deterministic race checks are in progress in both sources. Worker publication remains held until the final exact-source gate is green.
- That correction is now independently reviewed and frozen: exact owned original-payment pre-lock before either ticket INSERT, then atomic hold/event with the new ticket ID. Four direct/assistant versus request/acceptance PostgreSQL combinations add 20 bounded real-lock/receipt/seat/hold/no-refund assertions. Local API 888/888 Preview and 857/857 Production, both typechecks/builds and both trusted-touch class setup 170/170 passed. The final fresh isolated gate remains required before release.

## Fabrications found

None added. A completed session or brief connection is not evidence of full delivery. Practice receipts cannot become real refunds or actual earnings.

## Deliberately not changed

No billing plan, purchases, payment credentials, student identity requirement or automatic money movement. No whole-branch merge over the Production cost dashboard.

## Remaining risks / next pickup point

Full downstream CI, narrow Production make-up variant validation, staged activation, live participant smoke and final release evidence remain. The regression fixes are live; make-ups are not enabled yet. Physical iOS/Android and two-device real media were not tested by the synthetic browser gates.
