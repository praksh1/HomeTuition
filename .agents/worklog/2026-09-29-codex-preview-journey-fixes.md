# Preview class creation and classroom fixes

- Date: 2026-09-29
- Agent: Codex root with class creation, call layout and enrolled journey agents
- Branch: `codex/preview-journey-fixes-sep29`
- Base commit: `6854935420d30166a8f3afec5a768a5c6b6d9373`
- Status: in progress

## Requested

Fix lesson entry and timetable count changes, simplify course dates and earnings, expose safe draft deletion, restore maximized-call controls, distinguish enrolled students from prospects, improve previous-lesson and make-up presentation, remove report reference from success copy, and make profile photos directly viewable and replaceable.

## Changed

- `ClassSetup.tsx` and `utils/batchSchedule.ts`: two-digit lesson input (1–60), count/row reconciliation, confirmation before removing edited rows, clearing obsolete timetable errors, schedule-derived short-course first/last dates, prominent estimated net earnings with expandable fee details, and delete/discard in the persistent wizard footer. Existing transactional deletion safeguards remain authoritative.
- Both classroom routes and `utils/callWindow.ts`: expanded call reserves class context and control bands plus desktop chat/participants width; overlays no longer live inside the board's clipping/stacking parent; opening chat no longer disables the whole call. A real-coordinate route regression fixture is available as `test:classroom-call-layout`.
- `learningPrograms.ts`, program cards/view and `BatchTestPanel.tsx`: authenticated viewer-only enrollment facts in existing catalogue/detail queries, exact purchased batch links, Enrolled/Open my class actions, no buyer instructions or duplicate joining/date chrome for enrolled students, and no purchase invitation when enrollment lookup is unknown.
- `classGroups.ts`, `class-home.tsx` and `utils/lessonHistory.ts`: viewer-only own enrollment/connection evidence, unavailable evidence distinguished from zero, previous-lesson record/help actions retaining the exact original session. A connected student is called Joined, not automatically a completed/delivered class or a financial absence.
- `OwnProfilePhoto.tsx`, `ProfileHero.tsx` and account editor: directly view/change a photo without submitting unrelated contact fields; selected/saved preview, retry-safe upload, stale-read protection, and scrollable small-screen dialog. Existing backend file cleanup already catches storage failures.
- Conversation report confirmation omits the ticket reference while the operator ticket remains stored.
- Dormant `lessonRemedies.ts` policy now reserves courtesy allowance on request submission, not only teacher offers; release/acceptance/teacher-failure cases have focused tests. This does not activate make-up routes or payment holds.
- Browser fixtures cover these regressions. `scripts/preview-journey-readonly.mjs` is a strictly staging-only authenticated, read-only synthetic-account probe; it never logs credentials or starts a class.

## Decisions and assumptions

Preview is the release target for this regression pass. Production promotion is separate. The approved make-up policy remains two per paid tuition period, short-course allowance rounded up per ten purchased lessons and capped at three, no rollover, teacher failures quota-exempt, human-only refund/forfeiture review. Missing attendance cannot be labelled a student absence. A monthly daily timetable fits thirty lessons in thirty days; custom dates can contain more than one lesson per day. Short-course start/finish should be derived from its actual scheduled lessons.

## Verification

- Reviewed the supplied 4 minute 4 second recording as a chronological contact sheet. It demonstrates class creation/count reconciliation; it is not a call-window recording.
- Class setup: 170 browser assertions at 360/390/1440 and 20 focused helper/price tests. Independently checked actual localStorage discard/cancel/reopen behavior: 3 more assertions, no backend writes, new retry identity after confirmed discard.
- Call routes: initial 308 coordinate-based assertions, then final actual-Excalidraw engine matrix 350/350 across seven sizes per role, including rotation, real canvas/page-menu interaction, chat send, permissions, control-band separation and retained call mount. Geometry 29, chat UI 144, floor UI 360 and LiveKit surface 203 checks pass. API/socket/media transport are mocked; this is not physical Safari/Android or live audio/video proof.
- Discover: 282 browser assertions at 390/1440; messages 150; batch booking UI 90; discovery helpers 24 and query guard contracts 4. Enrollment failures also suppress Ready to join.
- Profile UI: 330 assertions including both roles at 390/1440 plus 320x568 and 844x320, delayed pre-save read, failed upload retry, failed post-save read, real scrolling and coordinate Save/Close actions. No private documents were uploaded.
- Class home: 50 browser assertions at 390/1440; 4 new history helper tests. Source attendance privacy contract: 13 class-group contracts pass. UI fixtures are synthetic and not actual PostgreSQL integration.
- Final combined workspace typecheck passes; app unit suite 614/614; backend suite 845/845 including attendance privacy contract and pending-request quota tests (21 focused remedy tests). Design lint remains at its baseline (56 hex/211 sizes); API and staging-target web build pass. Web export verifies Fadko name and the exact staging API target; Preview dry-run passes. Exact-bundle verifier unit tests: 7/7.
- Root visually inspected phone photo dialog, phone earnings, laptop short-course boundary review, and phone/landscape/laptop expanded-call/chat screenshots. Layout fixtures do not load all production font faces.
- Verified CLI access and the explicit staging service; staging/production database URLs and session secrets differ; upload buckets differ; staging uses LiveKit and has no real payment keys. Deployment and post-release checks remain pending.

## Problems and surprises

- The make-up foundation is not a working replacement booking flow. Activation still depends on transactional booking/refund/settlement/access checks and actual PostgreSQL tests. No local PostgreSQL executable/container was available; shared Preview is not a disposable financial test database.
- Reproduced the old call-route failures using read-only extraction of baseline 6854935: student Messages/More/Minimize intercepted; teacher chat-open Minimize/Expand intercepted. The corrected route matrix passes; media mounts are retained.
- Real Excalidraw rendering caught a 12px teacher dock/footer collision missed by the initial stub. Kept the established toolbar clearance and reserved the matching expanded-call band; root inspected the corrected actual-board phone screenshot. Regenerated the successful web build after that correction; the earlier capture is not the release input.
- First photo browser check assumed fade modal removal was synchronous; waiting for hidden state corrected the harness. Stale batch earnings assertion and a history assertion expecting Completed after missing-attendance hardening were updated to the truthful current output. Call/wizard harness timing/target checks were corrected before final green runs.
- An initial local pnpm Wrangler command was unavailable because Wrangler is not a project dependency; verified existing `npx` Wrangler 4.144.0 and its deploy flags instead. No package dependency or paid service was added.
- Existing untracked audit/build artifacts are preserved.

## Fabrications found

No new fabricated data was introduced. Corrected ambiguous elapsed-date labels without declaring a student no-show or a completed make-up; preserved truthful simulated-payment disclosures. An unavailable attendance query or older API response cannot become a Completed student attendance assertion.

## Deliberately not changed

No purchase, real payment, automatic refund/ban, production merge, document retention change or deletion of unrelated files.

## Remaining risks / next pickup point

Deploy verified changes to staging API and Preview Worker, verify exact served bundles and health, and run the read-only synthetic API probe. Full make-up requests, replacement assignment/acceptance, quota UI and payment holds are still inactive; the concrete activation work is tracked in `.agents/backlog/2026-09-30-live-makeup-workflow.md`. No further owner policy decision is required to implement the approved policy. Physical phone/live-call retesting remains necessary before Production promotion.
