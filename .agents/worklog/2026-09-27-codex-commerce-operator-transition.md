# Commission, identity and operator transition audit

- Date: 2026-09-27
- Agent: Codex
- Branch: `codex/support-case-workspace`
- Base commit: `1f0c560`
- Status: in progress

## Requested

Retire residual teacher-paid plans for new classes. Make student-paid tuition and Fadko's 30% commission clear; audit payment holds, lesson disputes, make-up lessons, teacher payouts and per-student/class receipts. Simplify large teacher/student schedules, show truthful teacher verification status, create a separate operator website/login, and stop requiring student or parent citizenship without deleting the dormant implementation. Continue first-time teacher/student usability testing. No purchases.

## Changed

- New class and teacher-earnings screens explicitly show the student tuition, 30% commission, 70% estimated teacher share and absence of a teacher-plan charge. If current terms cannot be loaded, the class wizard offers retry and blocks price review/publication instead of hiding the estimate. Renamed the class description's optional `outline` from “teaching plan” to “lesson outline” so it cannot be mistaken for a paid package. The active legacy standalone creator URL redirects to the new class wizard. `POST /sessions` now rejects new legacy creations outside isolated tests; existing contracts remain. Teacher-tier sales are now shut in every deployed runtime even if a stale `LEGACY_TEACHER_PLAN_SALES=enabled` variable remains; isolated tests can exercise historical contracts.
- The simulated teacher payment summary now lists the class title, paying student, receipt reference, gross tuition, Fadko share, teacher share and status. Student/teacher statement labels say “test” and do not imply that a bank transfer or refund actually occurred. Teacher receipts have a search, eight-at-a-time reveal and clear empty state; transaction history is similarly progressive. The participant API uses keyset pages of 50 instead of silently truncating at 50, and refreshes exactly those receipts' lesson evidence. The screen flags that totals/search cover loaded history until older receipts are fetched. The lesson-level ledger and 48-hour review/hold policy were tested, not converted into a real gateway. A late-ended lesson's 48-hour review now begins no earlier than its actual recorded end, preventing premature simulated eligibility.
- Student/parent citizenship is no longer solicited from active signup/Profile or the direct identity route. The server rejects student identity prepare/upload and does not block student bookings on identity approval. Teacher verification and operator approval remain booking gates. Dormant student/parent form, schema, retention policy and private-workflow code stay in the codebase for a future approved product decision.
- Teacher Dashboard review copy distinguishes account approval from private identity approval. Teacher classes retain search, status filters, grouped date sets and paging. Student Sessions now sort the first API page nearest-upcoming-first, load further lesson pages on demand, and avoid a false remaining count when a course spans pages.
- Added a local isolated `app-operator` Expo route tree, operator-ID/password login, one-time-password change, separate export script and Cloudflare Worker config. The public and operator web bundles are separate. A default-off `OPERATOR_SITE_ENFORCEMENT_ENABLED` server cutover gate is present; it has not been activated. Existing public admin routes and legacy admin login remain until migration and live authorization tests are complete.
- Updated identity release checklist, decision note and teacher-studio backlog to reflect current policy and unshipped gates.

## Decisions and assumptions

- New teacher classes use the existing approved 70/30 split; existing purchased legacy commitments are not repriced or silently migrated. No separate student platform fee is claimed.
- A per-lesson payout becomes eligible only after delivered evidence and the 48-hour complaint window; eligibility is not a bank transfer. Disputes and unfinished replacements hold the affected lesson share. Actual payout cadence, destination, provider custody/settlement and tax handling are unannounced and must not be invented in the UI.
- The owner's “maybe” automatic refund for an uncompleted make-up is not final authorization. Keep human refund review; do not silently release funds, forfeit payment or auto-refund. The approved courtesy make-up workflow remains unimplemented.
- Teacher identity collection and operator decisions remain inactive in production until the separate private-storage/cleanup/reviewer release checklist is satisfied. Student/parent collection must remain off even when teacher collection opens.

## Verification

- `pnpm.cmd --filter @workspace/api-server run typecheck` and `pnpm.cmd --filter @workspace/sikshya run typecheck`: passed after receipt pagination changes.
- `node --experimental-strip-types --test` for `batchTestMoney`, `teachingClass`, `identityPolicy` and `teacherBilling`: 26 passed.
- Focused financial engine (`programCommerce`, `batchTestSettlement`, `batchTestPayment`): 32 passed, including late-finish boundary coverage. This is simulation/logic, not a real-provider charge/refund.
- `pnpm.cmd --filter @workspace/sikshya run test:class-setup`: 115 phone and desktop browser checks passed, including 70/30 clarity, a failed-terms retry/publish guard, one-time conflicts, publish confirmation and compact teacher lists.
- `pnpm.cmd --filter @workspace/sikshya run test:sessions-ui`: 48 phone/laptop checks passed, including 140 lessons across five classes, progressive load and no horizontal overflow.
- `pnpm.cmd --filter @workspace/sikshya run test:teaching-billing`: 36 phone/laptop checks passed, including 25/55-receipt search, progressive reveal and older-page loading; test-only receipt screen was visually inspected.
- `pnpm.cmd --filter @workspace/sikshya run test:operator-ui`: 12 synthetic phone/laptop checks passed earlier this turn (separate login, no signup, forced password change). The operator static export completed locally and its bundle lacked public login/register UI; no deployed URL or real operator login was tested.
- The operator browser suite (12), student/teacher Sessions browser suite (48) and retired-plan policy unit suite (4) also passed on the final local verification pass.
- `pnpm.cmd --filter @workspace/sikshya run build`: first attempt failed because this local shell lacked `EXPO_PUBLIC_DOMAIN`; retried with explicit Preview domain and staging API URL and passed. Verified built API target and Fadko title. This is a local export, not a deployment.
- `test:profile-ui`: 256 phone/laptop checks passed after the fixture was updated for teacher-only citizenship. `test:signup-ui`: 38 passed, including no student document prompt and teacher verification guidance. Dashboard browser checks and account-notice tests passed earlier this turn. No paired real-account checkout, provider transfer, real email delivery or physical-device test was completed.

## Problems and surprises

- The student Sessions API returned only 100 lessons and ordered them newest-future-first. Several long courses could hide the closest lesson and omit an entire class. First page now prioritizes nearest upcoming lessons; older pages are explicitly reachable. A server-side grouped-query may still be warranted at much larger scale.
- A changed simulated-payment label initially broke one unit expectation. The status semantics were corrected (`refund_owed` means approved but unsent) and the suite then passed.
- The Profile browser suite initially failed because its old fixture expected a student identity form. The active student route intentionally no longer shows one. The fixture now verifies no student status request/upload and still exercises teacher DOB, consent, retry and review states; all 256 checks pass.
- Wrangler is unavailable in this shell; `wrangler.operator.jsonc` was not validated by Wrangler or deployed. Cloudflare static-assets documentation informed the isolated build shape, but cannot replace a real deployment check.
- The first large-receipt browser fixture broke an old assertion by changing the synthetic student's name; the one-receipt fixture was restored. Pagination and search then passed. The API query compiles but still needs a database-backed page-boundary test.
- This is a dirty shared worktree containing prior identity, closure and other changes. Nothing was reset, committed, pushed, merged or deployed in this task. Do not assume the diff is only this commerce slice.

## Fabrications found

- The student list visually implied its first 100 lessons were the complete set; later lessons were silently inaccessible. Fixed with explicit paging and partial-class copy.
- A simulated “paid to you” label looked like an actual transfer although `actualMoneyMovedNpr` is zero. Reworded as a recorded test payout.

## Deliberately not changed

- No actual payment gateway, merchant account, bank destination, real charge, real refund, payout transfer or purchase was made or activated.
- No payout cadence was published. The owner has been asked to choose a future real-payment cadence; until then the UI explicitly avoids a bank-arrival promise.
- No automatic make-up, refund, dispute decision, ban, payment release or closure was added.
- No operator URL was deployed and no production login was cut over. `OPERATOR_SITE_ENFORCEMENT_ENABLED` remains off pending operator-account migration and authorization testing.
- No student/parent identity source code or historic records were deleted. The direct student route now explains that documents are not required and blocks submission.

## Remaining risks / next pickup point

1. Prove the backend operator-only login cutover end to end with administrator-issued accounts, then deploy the separate Worker URL and retire public admin routes. Do not flip the enforcement flag first.
2. Run paired, real Preview teacher/student flows through verified email, teacher review, class publication, simulated enrollment, attendance, dispute and receipt. Use synthetic identities; the existing `example.com` accounts cannot prove email delivery. Verify no student citizenship prompts remain.
3. Implement the approved make-up offer/acceptance/completion workflow with atomic original-lesson linkage and frozen affected payout, then test failure, timeout, dispute and manual refund decisions. Define provider-specific reversal/reconciliation and actual payout schedule before real collection.
4. Verify the nearest-first student ordering against an isolated PostgreSQL fixture with more than 100 paid lessons, plus live payment/booking API error cases. The browser paging test currently mocks the API; it does not prove the SQL order in production.
5. Keep identity collection and account-closure rollout flags off until the private-data release checklist is complete. A prior combined storage test used a synthetic student before the policy reversal; replace that with a synthetic teacher test.
6. Exercise participant receipt pagination against a real isolated database with more than 50 bookings; the current 55-receipt regression is a browser mock, not proof of PostgreSQL results or settlement latency.
