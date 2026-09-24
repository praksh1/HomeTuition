# Production support promotion and teacher studio reliability

- Date: 2026-09-24
- Agent: codex
- Branch: codex/teacher-studio-sep24
- Base commit: d6aa2f2
- Status: complete

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

Support focused tests: 23/23 locally before promotion. First production gate 35970043187: compile, design, and server rules passed; app rules 561/562. See remediation below. Corrected support release **811cfee** then passed full production gate **35970765228** and deployed on 24 September at 08:09 UTC. Cloudflare version `e2fd0d4f-a5c2-41e2-886e-16f001f8a7fe`; independently fetched live bundle `entry-e0d4bdcfa40029a42264cc4d3b2ec8a1.js`, containing the correct production Railway URL. Railway commit status success and `/api/readyz` returned `status: ok`. The signed-in production Profile support panel was opened read-only and its automated-assistant/human-review disclosures verified; no support request was sent.

Teacher-studio isolated CI **35972391413**, c42f080: full typecheck, API unit **731/731**, app unit **562/562**, design lint, **143 real-API booking checks**, **101 class-setup browser checks**, **90 booking UI checks**, **38 Sessions UI checks**, all passed. Real API tests include 181-session pagination, all 14 overlapping dates, student/other-teacher preflight authorization, literal search and a forced post-commit homework-table read failure in disposable localhost PostgreSQL. The media provider is echo in this suite; this is not a new LiveKit media test.

Final compact-layout local browser run: **111/111** class-setup checks (360/390/1440 widths, Nepal/Chicago time zones), including search/filter behavior and laptop-card density. Screenshots rendered and inspected: `%TEMP%/fadko-simple-class-NgkBd2/1440-classes.png`; earlier phone confirmation/conflict screenshots also inspected. Browser harness uses real UI components with deterministic API fixtures; isolated CI supplies complementary real-database/API tests. No physical iPhone/Android validation claimed.

Full local typecheck and design lint passed after running outside the filesystem sandbox needed for dependency junctions. Existing design baseline: 56 hex and 211 raw-font occurrences; no new leaks. Full production release gate remains mandatory after push.

Final compact studio commit **ca3b05c** passed isolated CI **35973577650**, including **111/111** class-setup browser checks and the complete other checks above, then was fast-forwarded to main under the owner's explicit approval. Production web gate **35973877721** passed in 25m48s and deployed at **08:38 UTC, 24 September 2026**. Railway reports ca3b05c deployed successfully; `/api/readyz` independently returns `status: ok`.

Final Cloudflare version: `c6dc37b5-e16a-44b3-ac7b-78cd93e35aac`. Independently fetched production HTML/JS: HTTP 200, entry `entry-8ce7aa0bca450aeba38fa03e00fddb81.js`, correct production Railway URL, and the new studio-search and schedule-review code markers. The full production run also passed 60 support-assistant integration checks, 149 whiteboard checks and the existing real-server/browser journeys; no release gate was bypassed.

Signed-in production UI smoke check, in a temporary browser tab: reloaded to the new bundle; verified existing class rows, exact-name search, Drafts empty state, restored All list, compact laptop layout, and fresh Create a class at Step 1 with English/Nepali/Both/Other. No class was saved/published and no checkout or support request was submitted. Browser console error list was empty. Temporary tab closed. One automated empty-string search clear did not take and the next locator timed out; inspected the actual retained field, cleared it with normal keyboard select-all/backspace, and verified all rows returned. No app change was made on the strength of a tool-only timeout.

Owner-friendly test checklist: `docs/FADKO-PRODUCTION-CHECKLIST-2026-09-24.md`. Production support roadmap updated to reflect the owner's new promotion approval, while retaining all unimplemented/provider-activation limitations.

## Problems and surprises

An obsolete source assertion still expected the assistant to be disabled as “Soon.” The support assistant is now implemented and tested; updated the assertion to require its actual route plus automated-assistant and human-refund-review disclosures. No production gate removed or bypassed.

Dashboard asks for latest 40 sessions before sorting locally; Sessions asks for latest 100. Closest lessons can be excluded by server pagination. Booking notification preparation can throw after enrollment commits, misleading the caller into believing the booking failed. Repairs in progress.

Both root causes above are repaired and regression-tested. An initial teacher CI run, 35972074625, failed an old assertion that globally capped conflict details at ten. Updated it to verify the intended bounded-per-lesson behavior (all sixty affected lessons retained, no more than three matches per lesson); the next complete run passed. No gate weakened. Offline dependency installation lacked cache metadata; the normal frozen-lockfile install succeeded. Initial sandbox unit/typecheck attempts could not resolve dependency junctions; clean CI passed all tests.

## Fabrications found

Class creation retained outdated joining/payment-unavailable copy despite working simulated checkout; now aligned with actual capability without suggesting real payments are enabled. Recorded in the UI fabrication table.

## Deliberately not changed

Classroom/LiveKit controls, payment provider configuration, autonomous financial actions, new make-up entitlements, and quiz publishing.

## Remaining risks / next pickup point

Release is live; application commit ca3b05c is the production reference. Later documentation-only handoff commits do not represent another application release. Unspecified payment errors may have other causes; request the affected class/time or trace if reproduced. Deferred: durable retries for post-commit notifications, owner make-up choices, quiz implementation and the four classroom TODOs. The class creator is still a four-step workflow, with friction removed; no claim of a complete new wizard architecture. Carry the focused teacher-studio integration/browser checks into future production changes rather than relying only on the branch-specific workflow. Non-blocking CI maintenance notices: action runtimes were forced from Node 20 to Node 24; ubuntu-latest is scheduled to move to Ubuntu 26 on 19 October. Review these separately, not during a financial workflow fix.
