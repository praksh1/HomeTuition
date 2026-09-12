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

### Settlement release result

- Commit `1837160` pushed to `codex/batch-simulated-checkout`; preview source
  `codex/program-batch-foundation` fast-forwarded to the same commit. Main remains untouched.
- GitHub safety run `34672621006` passed every step, including disposable PostgreSQL schema push,
  extended batch booking/settlement integration, all unit suites, video/proof/access contracts and
  the40-check phone/laptop browser flow.
- Railway staging deployment `120bc805-bf6a-4ba0-a84f-e33516702fe2` is ACTIVE / successful.
  HTTPS health returned200; unauthenticated ledger request returned401 (protected route exists).
- Cloudflare preview run `34672831042` passed and deployed commit `1837160`, including its own
  typecheck, disposable database/API checks, rendered class/program flows and production-isolation
  proof. Preview URL unchanged. Owner still needs to perform the operator settlement walkthrough.

### Participant settlement view

- Commit `269b661` adds the same derived, read-only settlement totals to the booked student's and
  class teacher's existing test-class panel. It shows gross TEST payment, original teacher/Fadko
  allocation, gross still held, teacher test-paid, Fadko test-earned, student test-refunded and
  actual money moved (always NPR 0). Lesson rows use human-readable settlement state labels.
- No participant can make a settlement decision. Operator authority and the append-only event route
  are unchanged. Older API responses remain readable through honest zero/fully-held fallbacks.
- Local gates: full four-workspace typecheck; app unit 373; design ratchet unchanged 94/282; browser
  checkout/ledger 40/40 at 390 and 1440; diff check clean.
- GitHub safety run `34673306726` passed against disposable PostgreSQL. Cloudflare preview run
  `34673450705` passed and deployed commit `269b661`. Railway staging deployment
  `5d8f257b-ebe0-4c96-baaf-b13dc9b3ee00` is ACTIVE / successful on the same commit.
- Staging video remains `echo` after the unsuccessful Daily room attempt. Daily credentials and
  namespace remain inactive; production video, production API and `main` were not changed.

### System-owned settlement and operator exception desk

- Owner's real walkthrough exposed a product-design failure: the operator screen asked a human to
  manufacture ordinary facts with buttons such as delivered, cancelled, complaint opened and
  complaint window closed. The owner could not tell what they were supposed to do. Those controls
  are removed from the normal operator UI. The page now explains that Fadko updates routine test
  accounting from recorded classroom/session facts and student-created support cases. Ordinary
  receipts say `No operator action needed`; cancellation/dispute states link to support cases.
- Added a pure automatic transition policy and tests. A scheduled lesson does not count as
  delivered merely because its status says completed: recorded teacher presence is also required.
  A qualifying completed lesson opens its review period; the 48-hour window closes automatically
  from the scheduled end; a complaint created by that booking's student freezes only that
  student's allocation; a teacher-cancelled session becomes a replacement/refund exception.
- Automatic synchronization appends immutable system events with no actor and never confirms a
  real payout or refund. It runs before participant and operator test-ledger reads. If evidence
  synchronization fails, the API logs a warning and preserves the readable last-known ledger.
- This does **not** yet decide the outcome of a dispute, execute a payout/refund, or connect a case
  resolution to a settlement verdict. The internal rehearsal event API remains for automated tests
  and compatibility, but no longer appears as routine operator work.
- Commit `ea686d5` contains the product change. CI first failed because the booking journey tested
  a timetable clash only after intentionally completing the conflicting lesson. Commit `79a5c90`
  moved that proof to when both lessons are upcoming; no product logic changed. The next CI run
  exposed an existing timing race: the Programs API deliberately answers before a non-blocking
  moderation insert finishes, while the test queried immediately. Commit `37e1c2a` added a bounded
  two-second eventual assertion; it still fails if the promised moderation record never appears.
- Final safety workflow `34676572202` passed all steps: four-workspace typecheck, API/app units,
  design ratchet, disposable schema, Programs, batch booking and automatic settlement, video,
  evidence, teacher/student test access, and browser checks. Preview workflow `34676722500` passed
  and deployed commit `37e1c2a`. Railway staging deployment
  `3741cdd4-72f4-449f-a9fd-38762224c788` is ACTIVE / successful on the same commit.
- Production and `main` remain untouched. Staging video remains echo. No payment, purchase, Daily
  action, real payout/refund, or shared production-data mutation occurred.
