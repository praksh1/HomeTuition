# Simulated class checkout and ledger

- Date: 2026-09-11
- Agent: Codex
- Branch: codex/batch-simulated-checkout
- Base commit: 3b58906 (includes tested, inactive preview-video isolation)
- Status: in progress

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
