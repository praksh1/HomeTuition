# Teacher schedule conflict protection

- Date: 2026-09-11
- Agent: Codex
- Branch: codex/program-batch-foundation
- Base commit: 832d632
- Status: in progress

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

Run real DB race and route tests, render warnings at phone widths, deploy preview only. Owner checks
overlap refusal and adjacent acceptance before production. Student purchase conflicts and immutable
purchased terms remain checkout gates. Do not report preview ready until deployment is verified.
