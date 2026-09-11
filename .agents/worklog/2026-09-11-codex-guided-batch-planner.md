# Guided teacher Batch planning

- Date: 2026-09-11 UTC (10 September in owner's timezone)
- Agent: Codex
- Branch: codex/program-batch-foundation
- Base commit: be1dafa
- Status: complete (preview deployed; owner device review pending)

## Requested

Owner authorized Codex to take primary implementation responsibility, continue the usability work,
and only ask for critical decisions/review. Previous recording showed confusing menus, off-screen
actions and a laborious teacher scheduling flow. This slice implements the previously described
guided setup and repeat-date generation; it does not redesign the commercial contract.

## Changed

- Teacher `program-batches/[id].tsx`: separate Batch list and three steps (class size/price,
  schedule, review); always-available in-app Back and footer actions; step-specific validation;
  collapsed individual lessons; examples; explicit unsaved/save/publish distinctions.
- Repeat schedule from Lesson 1: weekly, Sunday–Friday, daily or chosen weekdays; 1–60 lessons;
  generates dates with the same Nepal wall-clock time/duration. Last date preview before applying,
  explicit replacement confirmation for an existing multi-lesson schedule, individual overrides.
  No automatic holiday skip, which the UI states. First date must match a selected weekday rather
  than silently shifting it. These are UI inputs to the unchanged server contract.
- Synchronous operation lock prevents racing writes. Responses preserve edits arriving before the
  visual lock. Reused existing web leave guard and native navigation prevention hook. Repeated
  generation cannot write/publish anything; Next only changes the visible step.
- Added token-only `BatchConfirmation`: bounded body scroll, visible actions, no fading decision
  left over the next step. No raw font sizes or colors added.
- `batchSchedule.ts` and tests: calendar arithmetic in UTC components (not device-local DST), strict
  date/time/count/day validation, Nepal-time review checks. `batchDateValue` now rejects rollover
  dates instead of accepting e.g. February 29 in a non-leap year.
- Shared Nepali picker: reset effect keyed by date value, not object identity; cannot confirm a
  preselected date outside its allowed range. Android time-picker cancel no longer applies a date
  merely because Android supplied one with a dismissed event.
- New `test:batch-planner` uses the actual screen/calendar/web history guard with synthetic API,
  router and native controls. Added it to preview workflow. No test writes staging/production rows.

## Decisions and assumptions

- Program remains the reusable teaching description; Batch remains one scheduled run. No prices,
  capacity limits, durations, paid entitlements, commission or refund rules were invented/changed.
- Preview remains read-only to students: no Join/Pay claims. Exact dates are reviewed before save;
  saved draft and published preview remain distinct, with the server the final authority.
- Sunday–Friday is a labelled shortcut, never a forced calendar. Freelance teachers can choose any
  days. No claim to have imported holiday/school calendars.
- Duplicate Batch and reusable saved schedule/price templates are deferred, not implicitly done.
  Do not add auto-publish or silently reuse old dates while implementing them later.

## Verification

- Full `pnpm run typecheck`: passed all four artifact/scripts workspaces and library build.
- App unit suite at first complete pass: 364 passed, 0 failed (358 existing + 6 schedule tests).
- Design ratchet: unchanged 94 hex / 282 sizes at first pass.
- Final app regression rerun: 364/0; final full typecheck and `git diff --check` passed.
- `test:batch-planner`: 51 checks pass at 360×640 Kathmandu, 390×844 Chicago, 1440×900 Chicago.
  Exercises validation, real BS calendar opening, native HTML clock input, recurrence, empty days,
  replacement cancellation, visible save/footer, failed-save retry, precise PATCH input, separate
  publication confirmation, actual browser Back/cancel/confirmed departure and actual reload dialog.
- Screenshots examined. Latest scratch directory:
  `C:/Users/missk/AppData/Local/Temp/fadko-batch-planner-PNWfEU` (not committed; disposable).
- Final checks, commit and preview deployment are recorded below when completed.

## Problems and surprises

- Sandbox typecheck could not resolve shared installed packages (datetimepicker, OAuth, LiveKit).
  Same check with installed-dependency access passed; no dependency reinstall or update was needed.
- First screenshots caught the old shared modal fading out while its content switched to a different
  decision, temporarily covering Review. Replaced with immediate dedicated token-based modal, then
  reran rendered checks and inspected screenshots. Earlier 28 checks did not catch this visually.
- Empty weekday selection initially fell back to the first weekday. Changed default to null so an
  explicit empty selection is respected; browser regression now requires disabled generation.
- Two attempted script reads used the repository scripts directory instead of the app's scripts;
  resolved from actual package scripts. PowerShell wildcard path passed to rg also failed; no edits
  resulted from either mistake.
- Optional inventory of an old recording-viewer helper process was denied by the sandbox; no
  process was modified. The current browser harness closes its own browser/server in `finally`.
- First preview pipeline `34561076611` stopped in the browser harness before deployment: after
  a clean publish then an edit, immediate browser Back did not show the leave question on Linux
  Chromium (Windows passed). The screen unnecessarily armed history during clean publish requests,
  creating extra push/pop transitions; guard now tracks actual dirty work only. The test now waits
  for the observable history sentinel to be removed after save and armed after editing, rather than
  assuming a React effect has run as soon as Playwright finishes typing. Retesting locally and CI;
  this failure must not be presented as a successful deployment.
- Corrected revision `1360590` reran 51/51 locally, and the formerly failing browser stage passed
  on Linux in preview retry `34561445017`. No gate was removed or disabled. Both actual reload
  dialogs and confirmed Back destinations remain asserted.

## Fabrications found

- No fabricated business data found. Removed inaccurate helper comment suggesting a local noon
  Date was universally timezone-safe; it is only a calendar carrier, never the serialized instant.
- Corrected earlier worklog's description of preview CI as a navigation gate. It runs rendered
  discovery/profile checks, not `test:nav`. This new batch harness tests real browser history but
  substitutes the Expo router/native navigator; it is not proof of complete Expo routing on phones.

## Deliberately not changed

No server route/query/schema/migration, payment, enrollment, refund, Monthly/Single Class,
Daily/LiveKit, sockets, checkout or subscription change. No purchase or production deployment.
No new runtime dependency. No mock data added to the application/server; fixtures live in tests.

## Remaining risks / next pickup point

Deploy this verified slice to preview, check served revision and staging health, then request owner
physical review before production. Test Android/iPhone clock cancellation, keyboard and hardware
Back; browser viewport tests cannot prove native behavior. Native navigation is wired/typechecked
but mocked in the browser harness. Real API authorization/schema parity runs in the existing CI;
this new harness deliberately tests UI/writes with a stand-in, not live server persistence.
Follow-up: duplicate a Batch with fresh dates; reusable scheduling defaults if still helpful;
commercial enrollment/checkout is separate and must not be inferred from this UI.

## Release ledger

- `a8359f5` — guided planner, recurrence, dialogs, tests and initial documentation; pushed.
- `1360590` — scope history protection to dirty work and synchronize the rendered test with the
  actual history guard; pushed. This is the application revision in the preview retry.
- Staging API health read returned 200 / `{"status":"ok"}` after the initial push.
- Preview workflow `34561076611` failed before build/deploy (see above).
- Retry `34561445017`: SUCCESS in 5m19s, application commit `1360590`. Passed database, evidence,
  discovery and new planner browser checks, web build, production-target refusal, deploy and exact
  served-bundle hash verification. Existing GitHub Node-20-to-24 action deprecation annotation only.
- Independently fetched `https://hometuition-preview.praksh-dhakal.workers.dev/program-batches/1`:
  HTTP 200, served `entry-606b7bfdadd608b1b7e885696f552f80.js`. This verifies the route's SPA shell,
  not an authenticated real teacher journey. Owner review still required.
- Final documentation-only commit follows the deployed application revision; no code differs.
- Nothing merged to main; production unchanged. Owner must physically review before promotion.
