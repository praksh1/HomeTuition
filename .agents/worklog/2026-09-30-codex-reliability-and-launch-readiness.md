# Reliability and launch readiness

- Date: 2026-09-30
- Agent: Codex
- Branch: codex/sep30-reliability-and-launch-readiness
- Base commit: 9f3bc39721b6edc882e6000305d6c28a04b8e0e6
- Status: in progress; not deployed.

## Requested

Investigate the owner's iPhone recording of delayed typing and intermittent load failures.
Simplify make-ups versus teacher non-delivery, automate well-defined financial outcomes,
audit the teacher/student journeys, supply a separate operator site, and prepare an
app-first phone release without compromising the desktop experience.

## Changed

- Message composer owns typing state; serialized device draft writes debounce at 500 ms.
  Failed outgoing text remains recoverable without overwriting a new draft. Direct and
  class timelines no longer redo date/attachment work on every keystroke. Hidden routes
  stop polling; concurrent socket/poll refreshes coalesce. Optional inbox draft loading
  no longer holds the network refresh open.
- One bounded retry of transient GET transport/502/503/504 failures, within the original
  deadline. No mutation, 401/403/429 or 500 is automatically replayed.
- Make-up inbox defaults to actual requests rather than every purchased lesson. A lesson
  help form distinguishes student absence from teacher non-delivery. Future teaching
  cannot be reported as already missed.
- Separate operator static-hosting configuration; existing Preview operator shell is
  promoted with the current make-up workspace. Backend authorization remains required.
- Make-up list reads the shared immutable receipt/timetable once per booking instead of
  repeating large blobs for every lesson; policy derivation is cached within that read.
- New v2 policy, exact-purchase/offer consent digests, integer refund allocations, additive
  shadow tables and a payment-row-locked PostgreSQL audit adapter. No runtime migration,
  scheduling or payment execution is imported. Existing v1 receipt/hold behavior is retained.
- Inactive app-first rollout helper requires verified published iOS and Android store links,
  preserves desktop and public/support/callback access, and does not block phone browsers.
- Scoped Preview pairing keeps its newer identity/closure foundation. No wholesale merge.

## Decisions and assumptions

Owner approved September 30: teacher responds within 48 hours; offered dates expire after
7 days; replacements finish within 30 days. Confirmed teacher non-delivery or failure to
arrange a requested replacement yields a full affected-lesson refund entitlement. An
absent student at an accepted courtesy replacement receives 70%, Fadko retains 30%, and
the teacher receives nothing, only with prior explicit consent. Uncertain evidence or an
outage goes to review. Purchased terms are immutable: no retroactive penalty.

Automation means deterministic policy, not autonomous AI financial decisions. A refund
intent or simulated ledger adjustment is not a bank transfer. Existing live test bookings
have no actual funds collected. Phone browser blocking must remain disabled until published
native apps can complete the classroom and critical user journeys.

## Verification

- Recording metadata: 4 minutes 59 seconds, 588 by 1280 pixels. Inspected overview and
  first-minute frame sequences; not a physical iPhone execution test.
- One live read-only sample: Production readiness 200 in 2254 ms; Preview readiness 200
  in 395 ms; Production frontend 200 in 551 ms. This does not disprove intermittent failures.
- Root typecheck across the workspace: passed. Design ratchet: passed, no new token leaks.
- App pure tests: 648 passed; API pure tests: 884 passed at the latest completed root run.
- Responsive make-up fixture: 81 assertions passed at 320/390/1440 pixels. Future teacher
  non-delivery reporting is hidden until the booked end; post-end report reason is distinct.
- Messaging fixture: 150 checks passed plus typing/focus/failure recovery at 390/1440 pixels.
  In the old release, 27 typed characters caused 810/540 formatter constructors/format calls
  in direct chat and 729/486 in class chat, with 27 draft writes. Fixed burst: zero of those
  timeline calls/writes, one draft save after pausing. This is a structural Chromium result,
  not real iPhone INP or universal latency proof.
- Targeted remedy/shadow/read tests: 56 passed. API build passed. PostgreSQL race checks
  are prepared in the guarded disposable-database harness, pending execution in CI.
- Final Production participant export passed all 129-chunk API target checks. Real-export
  route checks passed 162 assertions; saved-session startup recovery passed seven checks.
- Operator export passed 56 authorization, password, logout and recovery checks in each
  checkout at 320/390/1440 pixels. Final contrast changes are being re-exported sequentially.
- Clean CI startup recovery now runs after the participant export it actually requires.
  Isolated PostgreSQL and final release checks remain pending. No live release or
  provider-confirmed payment claim at this checkpoint.

## Problems and surprises

- Signed-in browser helper failed twice during sandbox startup; stopped retrying. Controlled
  browser tests and HTTP diagnostics remain available, but logged-in owner-browser inspection
  is not verified in this run.
- Dedicated Chrome performance connector unavailable. No Lighthouse or real iPhone INP
  score is claimed.
- Existing message tests replace draft persistence with a no-op. This hid per-keystroke
  storage work and must be covered by a regression test using real persistence logic.
- Native LiveKit remains unimplemented; current native clients use the older Daily provider.
- Existing attendance rows do not establish continuous observation health. Missing rows must
  not be treated as conclusive evidence of absence.
- Operator root index and admin index competed for '/': a signed-out deep link could reach
  a blank screen. The new explicit /login redirect removes the collision. Initial artifacts
  that predate this fix are withheld from deployment.
- No local PostgreSQL instance was available. The financial race tests must run against
  the workflow's isolated loopback PostgreSQL service, never Neon or Production.
- Large pre-existing Excalidraw CSS/code-frame warnings make Metro output noisy. Successful
  exit plus all-chunk target checks, not progress text alone, confirms export completion.

## Fabrications found

No claimed production outage cause, speed improvement, real refund, or October launch
readiness until supported by tests. Prior release gates did not prove physical iPhone typing.

## Deliberately not changed

No purchases, real payment activation, AI refunds/bans, retroactive penalties, identity
collection activation, or mobile-browser lockout. No wholesale merge of divergent Preview
and Production trees.

## Remaining risks / next pickup point

Measure and verify urgent runtime fixes, scoped browser and financial regression tests,
separate operator export isolation, safe exact-source release, then complete the missing
purchase-time policy/consent, observation coverage, refund reconciliation and native release
gates. Update this record with actual results before handoff.
