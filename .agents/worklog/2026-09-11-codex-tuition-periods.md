# Shared tuition periods alongside fixed courses

- Date: 2026-09-11
- Agent: Codex
- Branch: codex/program-batch-foundation
- Base commit: 53c6ac1
- Status: complete (preview delivered; owner device review pending)

## Requested
Implement the approved ongoing shared 30-day tuition model alongside fixed courses, with advance
student payment as the future purchase rule. Keep teacher planning straightforward.

## Changed
- Added `learning_program_tuition_groups` and `learning_program_batch_periods`, declared in
  `learningPrograms.ts` and the additive boot DDL. No columns changed on existing tables.
- `tuitionPeriods.ts`: pure 30-day boundaries and whole-lesson containment. Snapshot reader checks
  period validity; cutoff is period start, not first actual lesson. Existing fixed snapshots work.
- `programBatches.ts` routes: explicit fixed/ongoing creation, frozen first-publication anchor,
  period warnings, safe publication and serialized/idempotent next-period preparation.
- Teacher planner: distinct choices, 30-day price, BS/AD period summary, bounded weekday generation,
  explicit review and next-period action. Existing fixed-course template behavior preserved.
- Student ProgramView: published period details/price unit; no checkout or invented enrollments.
- Added pure, real-database and rendered browser regression tests; extended schema parity checks.

## Decisions and assumptions
First publication freezes the group anchor at Lesson 1. Full lessons must fit within the half-open
period; a lesson may finish exactly at the boundary. Next-period preparation copies only published
price/capacity, not dates, students or money. It is idempotent. Each period requires explicit review.
The 30-day cadence is not a calendar month or legacy Monthly attendance entitlement.

## Verification
- Full root typecheck: passed all four artifact packages plus libraries.
- API units: 507/507 passed with shared dependency access.
- App units: 367/367 passed.
- `test:batch-planner`: 123/123 at 360x640 Kathmandu, 390x844 Chicago, 1440x900 Chicago.
  Includes unchanged fixed-course tests and ongoing generation/publication/next-period draft.
- Visually inspected 360px tuition review and 1440px format choices. All output is synthetic, not
  proof of real device behavior. Screenshots: temp `fadko-batch-planner-ZQyGPp` (not durable).
- Design ratchet unchanged at 94 hex / 282 raw sizes; diff check passed.
- Real PostgreSQL tests and deployed preview verification still pending. Do not treat this as
  deployed or ready for owner testing until the continuation below confirms it.

## Problems and surprises
- Schema parity harness assumed every primary key had a database default; the new foreign-key
  primary key does not. Corrected the harness to inspect the actual declared default.
- Initial browser assertion caught absent BS/AD labels: both dates were rendered, but without
  explicit calendar labels. Added those labels (and honest out-of-range conversion handling).
- One large patch was rejected on an unmatched context line; no partial edits landed. Applied
  smaller exact patches instead.
- Sandboxed API unit run could not resolve the shared `jose` package. Same command with authorized
  dependency-cache access passed 507/507; this was not an application change.
- Pre-deployment review found period equality using JSON text, which is unsafe because PostgreSQL
  jsonb can reorder keys. Replaced it with explicit field comparisons and added a reordered-key
  regression assertion. No-op publication must survive a real database round trip.
- The first local commit's explicit staging list omitted the schema file. Working-tree review
  caught this before push; the unpublished commit was amended to include it.
- During the deployed browser walkthrough, the computer-use `fill` call changed the HTML clock's
  visible value without committing React's state. Keyboard clock controls did commit it. The
  normal Playwright rendered suite's time entry passes; no claim that native phone input was tested.
  The resulting staging fixture uses 03:00 Nepal time deliberately as synthetic test data, not a
  recommended class time. No existing owner Batch was modified.

## Fabrications found
None found so far. No claim of payment, automatic renewal or transferred enrolment is permitted.

## Deliberately not changed
Real checkout, enrolments, payouts, proration, Monthly/Single Class terms, video providers, production.

## Remaining risks / next pickup point
Owner should physically test ongoing tuition and next-period preparation on preview, especially
clock entry, BS date selection and small-screen scrolling. Do not merge/deploy production until
review. Next commercial slice is a Batch/period-specific frozen purchase contract and checkout
rehearsal; it must not reuse the Program-level enrollment uniqueness or enable a gateway. Still
unbuilt: paid student continuity across periods, reminders, collection, refunds/payout execution,
mid-period entry and legacy Monthly migration. No automatic attendance/refund rule was added.

## Release and deployed walkthrough
- Application commits: `a501b7d` (foundation), `a0a1bda` (JSON key-order correction), pushed to
  `codex/program-batch-foundation`. Earlier documentation commits `93ef92e` / `53c6ac1` also pushed.
- Preview workflow `34619135531` superseded/cancelled, NOT the release.
- Successful final workflow: https://github.com/praksh1/HomeTuition/actions/runs/34619297380
  at `a0a1bda`. Real PostgreSQL Program/Batch/schedule/parity suite **535/0**; attendance **74/0**;
  rendered discovery **160/0**; planner **123/123**; full typecheck passed. Served HTML and three
  exact bundles verified against staging; production-host exclusion passed.
- Existing GitHub Node20-action deprecation warning remains non-blocking; no dependency changes.
- Preview: https://hometuition-preview.praksh-dhakal.workers.dev/program-batches/1
- Browser tab 18, signed-in staging teacher: created **tuition group 1**, **Batch 8 / Period 1**,
  six-student capacity, NPR3000 example price, five weekly lessons from Sep15 to Oct13 at03:00 Nepal
  time. Period Sep15 03:00–Oct15 03:00. Saved, explicitly reviewed and published through real UI/API.
  Confirmed immutable-period wording and disabled unchanged Publish button.
- Prepared **Batch 9 / Period 2**, same group, Oct15 03:00–Nov14 03:00; only published price/capacity
  carried over, lessons empty, unpublished. Left the browser on the list for owner testing.
- Read-only public staging API confirms Batch8 snapshot, five lessons, full period price and
  period-start cutoff. Batch9 remains a draft. These are synthetic staging fixtures, no money,
  enrollments or access grants. Existing fixed Batches preserved. Production untouched.
