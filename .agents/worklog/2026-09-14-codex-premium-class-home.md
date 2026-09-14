# Premium Class Home journey

- Date: 2026-09-14
- Agent: Codex
- Branch: `codex/premium-student-class-journey`
- Base commit: `560dc3b`
- Status: in progress

## Requested

Continue upgrading Fadko after universal simulated checkout reached production. Make the student's post-checkout journey feel complete without enabling real payments or changing enrollment and pricing rules.

## Changed

- Added `utils/classLessonJourney.ts`, a pure schedule-state derivation for empty, current, upcoming and finished class timetables.
- Added the API server's current instant to `GET /class-groups/:id`; the app carries that clock forward by elapsed device duration instead of trusting a handset's wall clock.
- Rebuilt the Class Home hero so an in-progress lesson stays in focus, a future lesson is called next, and a fully elapsed timetable says “Schedule complete” without an “Open lesson” action.
- Added a bounded three-date schedule preview, a truthful remaining-date count, and a compact overflow count.
- Added direct role-specific navigation to Payments & receipts for students and Earnings history for teachers. No platform allocation, held-total or percentage copy appears on Class Home.
- Added a rendered browser journey at 390 and 1440 pixels and six pure boundary tests.

## Decisions and assumptions

- “Passed” means only that the scheduled time elapsed. It does not claim the lesson was delivered, completed or attended.
- The current scheduled lesson uses “Lesson time now,” not the crimson LIVE treatment, because the Class Home response does not prove a provider call is live.
- Current, future and past classification comes from the server-calibrated instant. A phone's incorrect time cannot skip or resurrect a lesson.
- The schedule preview is intentionally bounded at three rows for a useful phone overview; it does not replace the full timetable elsewhere.

## Verification

- Sikshya unit suite: 428 passed, 0 failed, including six new class-journey boundaries and the updated Class Home source contract.
- API unit suite: 566 passed, 0 failed when run outside the restricted filesystem sandbox.
- Workspace typecheck: 4/4 packages passed when run outside the restricted filesystem sandbox.
- `test:batch-booking-ui`: 82 passed, 0 failed at 390 and 1440 pixels.
- New `test:class-home`: 26 passed, 0 failed at 390 and 1440 pixels; current/upcoming/finished states, correct session navigation, role-specific records, touch floor, overflow and browser exceptions covered.
- Class Home screenshots were visually inspected at both widths. Latest temporary output: `C:\Users\missk\AppData\Local\Temp\fadko-class-home-xb2OQ2`.
- `lint:design`: no new leaks; baseline remains 90 hex literals and 270 raw sizes.
- `git diff --check`: clean after whitespace correction.

## Problems and surprises

- The first local typecheck and browser/API runs failed because the restricted filesystem sandbox denied pnpm junction traversal. The same gates passed outside that sandbox; no source correction was needed.
- The first Class Home bundle reached Expo's native module loader through `@expo/vector-icons`. The harness now replaces `expo-font`, as the repository's other rendered journeys already do.

## Fabrications found

- A finished schedule still displayed its final row as “Next lesson.”
- A lesson currently underway was skipped in favor of the first later lesson.

Both came from `future-or-final-row` logic and are now explicit, unit-tested states. The running fabrication table was updated.

## Deliberately not changed

- Enrollment, booking, lesson windows, refunds, payouts and price calculations.
- Daily or LiveKit provider behavior and credentials.
- Real payment gateways or money movement.
- Attendance/delivery decisions; elapsed schedule time is never presented as proof of delivery.

## Remaining risks / next pickup point

- Deploy the branch to preview and verify the real authenticated Class Home against staging data.
- The schedule preview does not yet offer a full-timetable route; the source listing still provides the complete lesson-date disclosure.
- Real Android/iPhone rendering and hardware Back remain physical-device checks.
