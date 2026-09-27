# Launch journey and classroom continuation

- Date: 2026-09-27
- Branch: `codex/support-case-workspace` in `.worktrees/classroom-production-sep24`
- Status: local implementation and audit; not pushed, deployed or a real-payment launch

## Decisions retained

The site may present the intended enrollment journey, but a student must see an unambiguous no-charge disclosure before confirming a simulated checkout and on its receipt. Neither simulated student fees nor teacher payouts are real transfers. Removing every disclosure would falsely represent financial events and create a dangerous launch blind spot. A real provider, reconciliation, refund rail, payout cadence and operator runbook are still release gates.

## Changes this continuation

- The student class offer now leads to a concise review of remaining lessons and price; the final action and receipt state clearly that this is a no-charge practice enrollment. Decline simulation is behind a secondary test-options control. The general class detail page no longer presents a redundant simulated-checkout banner ahead of that decision.
- Phone full-call sizing uses the visible viewport boundary in both teacher and student classrooms. A 440-point large-phone case was added to the LiveKit control suite alongside 390-point phone and 1440-point laptop cases. This is a browser regression, not an actual iPhone Safari check.
- A saved class PDF or JPEG/PNG/WebP image can be selected from the teacher's existing Add material tray for placement on the shared board. The session detail carries its class-group identity; the new read route requires authentication, class membership and the actual class teacher, verifies the material belongs to that class, caps bytes at 8 MiB and sends `Cache-Control: no-store`. It uses the existing verified private R2 file metadata. A failed read leaves the current board unchanged. No new permanent public file URL is created.
- The make-up policy now validates IDs, reason, prior courtesy count and schedule boundaries; an offer cannot be accepted after its expiry or replacement start. The simulated operator ledger no longer accepts `replacement_scheduled` without a linked accepted lesson. This is a safety guard, **not** an activated make-up workflow.
- Added negative authorization checks to the database-backed batch booking script for student board-source access and link-only materials. Those checks were written but could not run without a local API/database fixture.

## Verification performed

- App and API TypeScript typechecks: passed.
- `test:livekit`: 203 passed, 0 failed across 390/440/1440 widths.
- `test:board`: 154/154 passed, including 14-page PDFs, teacher/student scale, reconnect images, erase/undo, page sync and teacher view following.
- `test:discover`: 242 passed, 0 failed on phone/laptop fixture.
- `test:class-setup`: 115 passed across narrow phone, phone and laptop fixtures, including early timetable conflict editing, required joining choice and a stopped publication when commission terms cannot load.
- `test:sessions-ui`: 48 passed on phone/laptop fixtures with 140 lessons and progressive class loading.
- `test:batch-booking-ui`: 90 passed earlier in this continuation after aligning copy and old test receipt expectations.
- Focused settlement, commerce, simulated receipt and make-up policy tests: passed.
- After tightening make-up boundaries, the five focused make-up policy tests passed again; both app and API typechecks passed on the final local pass.
- `lint:design`: passed. `git diff --check`: no whitespace errors (Git only warned about future LF/CRLF conversion).
- `test:classroom` could not start: no local API at `127.0.0.1:8080`. No real R2-backed class-material read or iPhone Safari full-call test was run.
- Visually inspected the generated 390-point student My classes card, 1440-point teacher History list and 360-point publish confirmation. Their hierarchy and controls fit these fixtures; a one-class mock is not a substitute for observing a novice navigating eight teaching classes or many enrolled classes.

## Release-blocking work still open

1. Build a durable, transactionally linked make-up case/offer/acceptance/replacement session for each original booked lesson and allocation. Keep payout held until replacement delivery and review. Preserve manual refund review for teacher non-delivery; do not invent an automatic refund.
2. Test teacher/student/operator signup-to-dispute journeys with synthetic Preview accounts and an actual connected API/database, including error and concurrency cases, then separately validate real provider custody, refunds, payout destination/cadence and receipts before collecting real money.
3. Verify the saved-handout route against private R2, plus student denial and large-file/error recovery. Test maximum LiveKit window and browser-bar changes on iPhone 16 Pro Max/Pro Safari; headless Chromium cannot prove that behavior.
4. Continue premium Discover/My classes/teacher schedule UX with realistic many-class fixture and usability observation. Existing search and grouped agendas pass their current tests, but that is not proof that a novice teacher or student finds them effortless.
5. Design teacher-granted student whiteboard edits with an explicit server permission, scoped participant/page, revocation, audit trail and reconnect handling before exposing editable controls. The current student board correctly remains read-only.
