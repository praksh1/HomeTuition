# Shared tuition periods alongside fixed courses

- Date: 2026-09-11
- Agent: Codex
- Branch: codex/program-batch-foundation
- Base commit: 53c6ac1
- Status: in progress

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

## Fabrications found
None found so far. No claim of payment, automatic renewal or transferred enrolment is permitted.

## Deliberately not changed
Real checkout, enrolments, payouts, proration, Monthly/Single Class terms, video providers, production.

## Remaining risks / next pickup point
Finish routes/UI/regression gates, deploy isolated preview and give the owner a physical test path.
