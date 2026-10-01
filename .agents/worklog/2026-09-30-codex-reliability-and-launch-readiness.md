# Reliability and launch readiness

- Date: 2026-09-30
- Agent: Codex
- Branch: codex/sep30-preview-reliability
- Base commit: 8b1ab3904d278e971acd678c5d7b4da34db2d76a
- Paired Production branch: codex/sep30-reliability-and-launch-readiness
- Status: reliability release deployed and live-checked; broader launch work remains incomplete.
- Deployed runtime source: a30e7b99211cd27cf1549a514218d185e234da50.
- Exact-source full CI: 36798186811, SUCCESS.

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
- Student Classes reads validated owned-session pages before replacing the list; a failed
  later page preserves the previous complete list. Stale focus/account reads cannot commit.
- Teacher Home removes retired plan limits and opens earnings history. New teachers can
  read the 48-hour review, dispute/make-up holds and bank-transfer distinction before their
  first student enrollment. Nepal calendar-day labels replace elapsed/device-time labels.

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
- Final exact-source Preview CI: 665 app pure tests and 917 API pure tests passed.
- Responsive make-up fixture: 81 assertions passed at 320/390/1440 pixels. Future teacher
  non-delivery reporting is hidden until the booked end; post-end report reason is distinct.
- Messaging fixture: 150 checks passed plus typing/focus/failure recovery at 390/1440 pixels.
  In the old release, 27 typed characters caused 810/540 formatter constructors/format calls
  in direct chat and 729/486 in class chat, with 27 draft writes. Fixed burst: zero of those
  timeline calls/writes, one draft save after pausing. This is a structural Chromium result,
  not real iPhone INP or universal latency proof.
- Targeted remedy/shadow/read tests: 56 passed. API build passed. First Production CI
  (36797244344, source 82ad9607) passed 886 API pure tests, 648 app pure tests and 173 real
  disposable PostgreSQL make-up checks, including 25 duplicate evaluations, payout races,
  legacy-consent protection, outage review and a database constraint rejecting cash claims.
- Final follow-up source passed full CI before deployment. Production billing passed 63
  checks; Preview passed 83. Owned pagination/grouping passed 12 pure checks each; this
  Preview student schedule fixture passed 46. Nepal-calendar labels passed three
  additional cases. Isolated PostgreSQL passed 175 make-up and 151 batch-booking checks.
- Final Preview participant export passed all 130-chunk API target checks. Real-export
  route checks passed 162 assertions; saved-session startup recovery passed seven checks.
- Operator export passed 56 authorization, password, logout and recovery checks in each
  checkout at 320/390/1440 pixels. Final contrast changes were exported and verified.
- Clean CI startup recovery now runs after the participant export it actually requires.
  Isolated PostgreSQL and exact-source release checks passed. This is not proof of actual
  provider-refunded money or physical-phone performance.

## Actual deployment and live checks

- Preview Railway API deployment: 22738f4b-16d3-4db0-8744-f3ad63d3a53d, SUCCESS.
- Preview participant Worker version: d9f724b4-2e43-46d8-ba3e-bc80066cfb3a.
- Preview operator Worker version: 951ca462-ccb4-4652-aaf7-e79663f3729b.
- Live participant root and /makeups returned HTTP 200 and referenced the exact locally
  verified entry-17ae280ff6a3e540eed37f470a73125c.js bundle.
- Both APIs returned readiness 200. Operator /login returned 200 with Fadko Desk title,
  no-store and DENY framing. Both new operator origins passed API preflight checks.
- Anonymous operator access returned 401; synthetic student/teacher credentials were
  refused operator access with 403. No live accounts, bookings, messages, tickets, identity
  uploads or payments were created by these checks.
- Existing make-ups remain enabled. The v2 shadow policy has not been activated, imported
  into startup, migrated into live storage or connected to settlement. Identity collection
  and account-closure completion flags were not enabled. No real money moved.

## Problems and surprises

- Signed-in browser helper failed twice during sandbox startup; stopped retrying. Controlled
  browser tests and HTTP diagnostics remain available, but logged-in owner-browser inspection
  is not verified in this run.
- Dedicated Chrome performance connector unavailable. No Lighthouse or real iPhone INP
  score is claimed.
- Older message fixtures replaced draft persistence with a no-op, hiding per-keystroke
  work. This release adds real persistence-path typing regression coverage.
- Native LiveKit remains unimplemented; current native clients use the older Daily provider.
- Existing attendance rows do not establish continuous observation health. Missing rows must
  not be treated as conclusive evidence of absence.
- Operator root index and admin index competed for '/': a signed-out deep link could reach
  a blank screen. The new explicit /login redirect removes the collision. Initial artifacts
  that predate this fix are withheld from deployment.
- No local PostgreSQL instance was available. The financial race checks passed in CI's
  isolated loopback service, never against Neon or Production.
- Read-only live owner access check: Production's configured owner exists but has no issued
  operator account. Preview does not configure an owner ID. Separate login export readiness
  does not prove the owner's credentials are provisioned. Existing owner login remains intact;
  do not force migration or claim owner sign-in is verified at the new operator URL.
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

The urgent regression release is deployed. Next: teacher Schedule pagination, accessible
Start/Join, and secure owner operator provisioning that preserves existing Cost & Health
ownership. Then connect prospective purchase/offer consent, authoritative observation
coverage, deterministic deadline processing, idempotent full/partial refund ledger and
payout exclusion, simulation receipts, and eventual provider reconciliation. These are
not complete. Physical iPhone/Android verification and native LiveKit remain launch gates.

An attempted broad unattended follow-up covering owner access, financial integration and
Production promotion was rejected by auto-review as too risky. No workaround was used.
The narrower same-chat heartbeat fadko-teacher-schedule-follow-up is ACTIVE hourly and
may only implement/test the local Preview teacher Schedule and Start/Join UI task.
It cannot deploy, push, change credentials, schemas or financial rules. It stops upon
completion or a genuine owner/tool blocker. Local scheduled runs require the computer
powered on, the app running and the checkout available. Remaining financial/access work
is outside that unattended task and needs an active reviewed work session.
