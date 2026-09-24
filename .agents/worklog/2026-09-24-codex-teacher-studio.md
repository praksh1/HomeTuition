# Production support promotion and teacher studio reliability

- Date: 2026-09-24
- Agent: codex
- Branch: codex/teacher-studio-sep24
- Base commit: d6aa2f2
- Status: in progress

## Requested

Promote completed support work; retain prior classroom TODOs; repair agenda ordering and simulated booking errors; simplify creation, timetable conflict resolution, and class management. Propose make-up policy; retain document-to-quiz roadmap.

## Changed

Approved support branch merged into production main at d6aa2f2. Prior classroom work preserved. Owner backlog recorded in `.agents/backlog/2026-09-24-teacher-studio-and-remedies.md` and persistent memory.

Teacher repairs in c695376/c42f080, followed by compact-layout polish:

- `routes/sessions.ts` + `utils/teacherAgenda.ts` + teacher Dashboard/Sessions: one server-time nearest-first query, filtering expired lessons before pagination; deterministic date/id ordering. Dashboard refreshes while focused and displays a retry rather than a false empty schedule.
- `routes/batchTesting.ts` and `BatchTestPanel.tsx`: post-commit notification failure no longer reports a failed enrollment; ambiguous POST response is recovered with one authoritative GET, never an automatic payment retry. Stale quotes require a new explicit confirmation. Successful receipts survive failed refreshes; stale component responses are ignored.
- `routes/teachingClasses.ts`, `scheduleIntervals.ts`, `ClassSetup.tsx`, `ScheduleConflictPanel.tsx`: read-only date-step preflight, all affected lessons shown with up to three conflict sources each, safe other-class links and same-screen editors. Publication still performs its locked authoritative check.
- `TeachingLanguageChoice.tsx`: English/Nepali/Both/Other. Explicit joining decision for new classes; existing fixed-course/ongoing eligibility retained.
- Teacher `teaching-classes.tsx`: server-side literal search, status filters, grouped/collapsed date sets, compact laptop rows, touch-sized phone actions, schedule shortcut, more-page loading preserves current rows. Removes per-card simulated-checkout requests; list reads skip the expensive schedule review done on detail/publish.
- Publication dialog previews description, language, capacity, price and exact lessons, and explains paid commitments. No financial policy changed.
- Added `.github/workflows/teacher-studio-checks.yml` with a disposable local PostgreSQL database and real-API/browser checks. Extended existing booking and class-setup harnesses.
- Proposed make-up design and quiz roadmap in `docs/FADKO-LESSON-REMEDIES-AND-QUIZZES-2026-09-24.md`; unresolved owner choices indexed in HANDOVER section 8.

## Decisions and assumptions

No purchases or paid provider activation. Refunds/bans remain human decisions. Make-up policy is a proposal, not an authorization to change financial rules. Quiz remains a separate follow-up.

## Verification

Support focused tests: 23/23 locally before promotion. Full production gate 35970043187: compile, design, and server rules passed; app rules 561/562. See remediation below. Production web has NOT yet deployed this release.

Teacher-studio isolated CI **35972391413**, c42f080: full typecheck, API unit **731/731**, app unit **562/562**, design lint, **143 real-API booking checks**, **101 class-setup browser checks**, **90 booking UI checks**, **38 Sessions UI checks**, all passed. Real API tests include 181-session pagination, all 14 overlapping dates, student/other-teacher preflight authorization, literal search and a forced post-commit homework-table read failure in disposable localhost PostgreSQL. The media provider is echo in this suite; this is not a new LiveKit media test.

Final compact-layout local browser run: **111/111** class-setup checks (360/390/1440 widths, Nepal/Chicago time zones), including search/filter behavior and laptop-card density. Screenshots rendered and inspected: `%TEMP%/fadko-simple-class-NgkBd2/1440-classes.png`; earlier phone confirmation/conflict screenshots also inspected. Browser harness uses real UI components with deterministic API fixtures; isolated CI supplies complementary real-database/API tests. No physical iPhone/Android validation claimed.

Full local typecheck and design lint passed after running outside the filesystem sandbox needed for dependency junctions. Existing design baseline: 56 hex and 211 raw-font occurrences; no new leaks. Full production release gate remains mandatory after push.

## Problems and surprises

An obsolete source assertion still expected the assistant to be disabled as “Soon.” The support assistant is now implemented and tested; updated the assertion to require its actual route plus automated-assistant and human-refund-review disclosures. No production gate removed or bypassed.

Dashboard asks for latest 40 sessions before sorting locally; Sessions asks for latest 100. Closest lessons can be excluded by server pagination. Booking notification preparation can throw after enrollment commits, misleading the caller into believing the booking failed. Repairs in progress.

Both root causes above are repaired and regression-tested. An initial teacher CI run, 35972074625, failed an old assertion that globally capped conflict details at ten. Updated it to verify the intended bounded-per-lesson behavior (all sixty affected lessons retained, no more than three matches per lesson); the next complete run passed. No gate weakened. Offline dependency installation lacked cache metadata; the normal frozen-lockfile install succeeded. Initial sandbox unit/typecheck attempts could not resolve dependency junctions; clean CI passed all tests.

## Fabrications found

Class creation retained outdated joining/payment-unavailable copy despite working simulated checkout; now aligned with actual capability without suggesting real payments are enabled. Recorded in the UI fabrication table.

## Deliberately not changed

Classroom/LiveKit controls, payment provider configuration, autonomous financial actions, new make-up entitlements, and quiz publishing.

## Remaining risks / next pickup point

Finish final production gate, confirm exact served entry bundle and Railway commit/readiness, then record deployment evidence here. Production automatic API deployment is independent of the web gate; monitor both. Do not claim an in-progress workflow is a live release. Unspecified payment errors may have other causes; request the affected class/time or trace if reproduced. Deferred: durable retries for post-commit notifications, owner make-up choices, quiz implementation and the four classroom TODOs. The class creator is still a four-step workflow, with friction removed; no claim of a complete new wizard architecture.
