# Simulated class checkout and ledger

- Date: 2026-09-11
- Agent: Codex
- Branch: codex/batch-simulated-checkout
- Base commit: 3b58906 (includes tested, inactive preview-video isolation)
- Status: complete (simulated checkout preview); real media activation pending

## Requested

Owner clarified that plain free enrollment is NOT the desired trial: students must simulate a
purchase of the quoted class, with teacher/Fadko accounting. Refund simulation is a later step.
Owner signed into preview operator and supplied Daily usage screenshots.

## Changed

- Added immutable batch_test_payments table, one simulated capture per batch booking, with
  frozen gross, 70/30 allocation, per-lesson amounts/positions and no real-money movement.
- Capture and enrollment share the existing locked booking transaction. Missing test-gateway
  confirmation is refused; declined simulation writes no booking. Retries return the same receipt.
- Student test checkout supports success, decline and cancel; never asks for PIN/card/wallet.
- Teacher class panel reads its own test receipts. Operator Program rehearsal has a separate,
  read-only latest-50 class-test ledger; it does not mix older Program rehearsal enrollments.
- No backfill of invented captures for earlier free test bookings.

## Decisions and assumptions

Use previously approved beta 70/30, no extra student fee. Allocations are held, not earned or paid
out. Real enrollment remains test/test_access/null reference; real payment and earnings queries
stay untouched. Snapshot allocation state is immutable; future refund/payout work needs separate
append-only events, not editing captures. No Daily recording activation.

## Verification

Initial local receipt tests 3/3; full named-workspace typecheck passed after building shared
declarations; design ratchet unchanged 94/282; checkout rendered tests 30/30 at390/1440.
Inspected generated390px booked screenshot. Additional operator panel and CI checks pending.

Continuation: full safety CI34669036220 passed at d7ca3d5, including disposable PostgreSQL,
both unit suites, program/batch booking, provider contract, proof, teacher/student grants and UI.
Extended local UI suite34/34 includes operator receipt view at390/1440; inspected390px operator
screenshot, no clipping. New allocation tests cover tiny prices and maximum safe-integer totals.
Teacher staging user1 test grant renewed through2027-01-10 via operator UI, success dialog
confirmed. Student user2 already active through2026-09-17; attempted renewal dialog stalled the
browser. Asked owner to Cancel, owner confirmed done; do not assume revocation occurred.

## Problems and surprises

Direct API typecheck before building shared libraries could not see new schema export. Full
root typecheck regenerates declarations and passes. Existing Program allocation helper forbids
total below lesson count, while Batch prices permit it; batch allocator conserves whole NPR with
zero allocations where necessary and BigInt total split. No change to old commercial helpers.
Chrome native browser access was stopped in preceding turn by safety URL detection. Owner supplied
screenshots instead:42 of10000 included participant-minutes used,0 recording/storage usage,
estimated$0.00. This is a point-in-time observation, NOT a hard spending cap. Do not copy the
billing-portal URL/session secret visible in the screenshot into logs or browser actions.

## Fabrications found

The older plain no-charge bridge did not meet owner's intended payment rehearsal. Corrected
wording and added genuine simulated capture records; never call them provider-confirmed receipts.

## Deliberately not changed

Production, gateway credentials, real money, real refunds/payouts, Monthly homework/chat,
membership logic, Daily selection/configuration and paid service plans.

## Remaining risks / next pickup point

Run disposable DB safety CI, deploy matched preview frontend/API only after passing, renew
synthetic test grants through fixed pilot deadline. Real Daily testing remains separate: namespace
and private-token code must be deployed before attaching credentials; action-time credential
authorization required. Owner has now signed in as operator; no new account needed.

### Release progress

- Code d7ca3d5; extra rendered operator checks/documentation6da5489, both pushed to
  codex/batch-simulated-checkout. Fast-forwarded staging source codex/program-batch-foundation
  to6da5489; main untouched.
- Safety CI34669036220 SUCCESS: API537, app373, Programs601, batch50, video42, proof125,
  teacher grants26, student grants108, class setup75, checkout30. Local extended checkout/operator34.
- Railway staging deployment486424b6-ba04-453b-807b-0a6e3afd81b0 ACTIVE; startup log confirmed
  learning program/test-booking tables present. Existing stage payment mode remains SIMULATED.
- Preview web run34669241451 in progress at this checkpoint; do not claim website released yet.
- Owner cancelled the blocked student-grant dialog; re-read showed same active grant through
  17Sep2026. No revocation or renewal occurred for student. Teacher renewal succeeded.
- Asked action-time permission to attach stored Daily credential to staging/private namespaces;
  awaiting answer. VIDEO_PROVIDER remains echo. Do not call any automated echo proof real media.

### Verified preview handoff

Preview run34669241451 SUCCESS at6da5489. Worker30a77f51-f2bc-46df-b4d6-4f54acc0f12c.
Workflow verified served HTML and3 exact bundles against the staging API. Operator's real signed-in
preview at /program-commerce shows new Class checkout test ledger; Show test receipts returned
the honest empty state, proving new authenticated endpoint and table work together on deployment.
No synthetic purchase was made in shared staging by this turn; owner performs student checkout.
Manual Android/iPhone and real media remain unverified. Production main untouched, no purchases.
Use preview student account to open published class -> Try test checkout -> Simulate successful
payment, then review TEST receipt and lesson links. Operator reloads the new ledger; do not use
the older Program test-enrolment form below to test this new batch-specific checkout.

### Append-only settlement continuation

- Added `batch_test_ledger_entries`: one immutable event per operator decision and purchased
  lesson position. It never mutates the captured quote or receipt.
- Reused the approved Program allocation state machine: future to delivered review or replacement;
  complaint decisions; payout/refund only from their eligible states. A reason is required for
  refund and complaint verdicts. Impossible transitions return conflict instead of succeeding.
- Operator test ledger now shows held gross, simulated teacher payout, simulated Fadko earning,
  simulated student refund and actual money moved (always NPR0). Student and teacher read the same
  derived settlement through their existing scoped class endpoint.
- No provider/gateway call, no real payment row, no ordinary earnings, no real refund/payout.
- Local verification: root typecheck pass; API unit537 and app unit373 pass; receipt/state unit24;
  design ratchet unchanged94/282; browser checkout/operator settlement40/40 at390/1440. Disposable
  PostgreSQL integration cannot run on this Windows checkout (no local Postgres); its extended
  checks are wired into `batch-test-checks.yml` and must pass in CI before preview deployment.
