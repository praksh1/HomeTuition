# Teacher schedule conflict protection

- Date: 2026-09-11
- Agent: Codex
- Branch: codex/program-batch-foundation
- Base commit: 832d632
- Status: complete — deployed to preview, awaiting owner physical review before production

## Requested

Owner approved preventing teacher double-booking before Batch payments. Save conflicting drafts
with warnings, refuse conflicting publication, account for other Batches, Single Classes, Monthly
lessons and make-ups. End-to-start adjacency allowed; different teachers independent.

## Changed

Shared half-open interval comparison and Nepal-time named refusals. Teacher-wide transaction lock
reuses the existing schedule quota lock; Batch publication, Single Class create/reschedule/duration
edits, Monthly creation/time changes/make-ups and day materialisation/generation participate.
Published snapshots reserve time even when the parent Program becomes hidden; draft replacements
do not replace reservations. Active recurring timetables project around proposed slots even beyond
generated cycle rows. Recorded regular days supersede projections, including cancellations.
Batch owner responses carry schedule issues; saved draft warnings are visible in the planner.

## Decisions and assumptions

Drafts do not reserve time. Closing a Batch releases its reservation in this pre-checkout feature;
that is not cancellation of any paid enrollment (none exists). Existing conflicting offers are not
automatically cancelled or edited. No-op publication does not create a new promise. Ten readable
conflict messages maximum, with all slots rechecked on each attempt. Active Monthly timetable
continues to reserve its daily time beyond the generated cycle until ended, matching recurrence.

## Verification

Initial full typecheck caught three unknown-typed fields in the existing session PATCH record;
corrected to use validated request values and current locked row. Then all four packages passed.
API unit tests 504/0; app tests 365/0; rendered planner 87/87 across 360/390/1440px;
ratchet unchanged 94 hex / 282 sizes; diff check clean. Examined 360px conflict screenshot,
then suppressed duplicate warnings after a refused publication. Real DB checks and preview
outcome to be recorded below.

First application commit `d62e3e0`, preview workflow `34566341975`: real PostgreSQL Programs/
schedule checks and attendance checks passed before the rendered stage. Review then added a
cancelled-class reactivation guard plus Monthly time-change and reactivation route assertions;
these require a fresh final workflow run before owner handoff.
Final application commit `b275344`; workflow `34566526299` has passed its real DB tests,
including the new Monthly-change and reactivation checks. Earlier workflow was superseded and
cancelled after its checks (503 Programs/schedule, 74 attendance, 160 discovery, 87 planner passed),
not represented as a completed release. Final deployment outcome remains to be recorded.

Final release: workflow `34566526299` SUCCESS in 4m52s, application `b275344`. Gates: full
typecheck; real DB Programs/schedule 506/0; attendance 74/0; rendered discovery 160/0; planner
87/87; preview verifier and production-host exclusion passed. CI emitted a non-blocking existing
Node20-action deprecation warning (actions forced to Node24); dependency/workflow upgrade not
part of this task. No failing final checks.

Authenticated served-preview verification in a fresh browser tab at
`https://hometuition-preview.praksh-dhakal.workers.dev/program-batches/1`: Batch list loaded;
opened existing Batch 5 and saw four real conflict messages with Batches 4/6, named Mathematics,
lesson numbers and complete Nepal-time intervals. The disabled unchanged-publication state and
Edit details remain present. This verifies frontend/API wiring with actual staging data; this
browser check was read-only, not a new publish attempt. No existing Batch was edited or closed.
Owner must still physically test corrective editing on phone; automated publish refusal and
atomicity are established by the real API/DB suite, not inferred from the warning.

## Problems and surprises

The old Batch validator checked only increasing starts, not occupied intervals. Make-up checks
were only within one recurring course. Fixed both directions of cross-product promises rather
than making only the newest Batch page aware. Monthly generation/materialisation also needs the
same lock to avoid briefly seeing neither the planned day nor its newly-created session.
Two read-only rg commands initially used PowerShell-incompatible filename wildcards / guessed
schema names; corrected by discovering paths. One apply_patch invocation was rejected before any
edit because it named a target twice; corrected and reapplied.

## Fabrications found

No invented financial data. Existing Program test suite's unchanged-table-count check is retained
before the new schedule integration cases; the new cases explicitly create and clean up their own
synthetic Single Class/Monthly fixtures. Those tests must not be described as non-mutating.

## Deliberately not changed

No student checkout conflict implementation: Batch paid checkout is absent. No payment activation,
refund/payout formula change, membership change, classroom/video change, purchase, schema migration,
production deployment or automatic rescheduling of existing classes.

## Remaining risks / next pickup point

Real DB race/route tests, rendered checks and preview release completed. Owner checks
overlap refusal and adjacent acceptance before production. Student purchase conflicts and immutable
purchased terms remain checkout gates. Do not report preview ready until deployment is verified.
