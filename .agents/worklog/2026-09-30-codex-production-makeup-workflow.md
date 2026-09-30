# Scoped Production make-up workflow promotion

- Date: 2026-09-30
- Agent: Codex production_promotion, with makeup_backend and makeup_integrations
- Branch: codex/production-makeup-workflow-sep30
- Base commit: 4bfb7e979c0f08eae5a88de5393deccc597a05f8
- Status: completed and live in Production and Preview

## Requested

Complete the approved linked make-up request, teacher assignment, student acceptance, quota display and original-payment hold workflow. Promote only reviewed dependencies to the Production branch after the separate regression release. Root owns commit, push, deployment and live verification.

## Changed

- New policy/core/schema/view/router modules and focused tests under `artifacts/api-server/src/lib/lessonRemedy*`, `makeupPolicy*`, `lessonRemedies*`, `routes/lessonRemedies.ts` and `lib/db/src/schema/lessonRemedies.ts`. Core modules originate from reviewed Preview source `8837e78b`; backend owns its later reopen-DTO correction.
- A narrow read-only `accountClosureStatus` adapter permits older deployments without a closure table, while installed closed-account rows and query failures remain authoritative. This does not install or activate closure or identity collection APIs.
- Targeted membership/session allowance/session ownership, replacement privacy, shared overlap locks, immutable seat/refund guards, ledger transitions, original-allocation holds, refund/payout decisions, support context and notification integration hunks. Ordinary identity and LiveKit provider settings are unchanged.
- Participant `makeups.tsx` and uniquely routed operator `(admin)/operator-makeups.tsx` use the shared `MakeupsWorkspace`; class home, lesson details and original receipt statements link to the exact original/replacement lesson. Operator desk navigation and make-up notification routing are registered.
- API PostgreSQL harness `scripts/lesson-remedies/{run,financeChecks}.mjs` originates from `b2d8d295`, including exact case-ID lookups rather than assuming the first historical case. It restricts execution to local disposable `fadko_makeup_test*` databases and neutralizes real external providers. Early active-operator fixture is explicit.
- Production-only harness adaptation seeds a synthetic local closure-status table instead of calling absent closure APIs; removed only two full closure API assertions. The closed-account commitment refusal and read-only adapter unit checks remain. Integrations owns additional reopen assertions.
- The CI workflow keeps the existing `fadko_test_booking` guard/database for old booking suites, creates a separate `fadko_makeup_test` database for make-up integration checks, and adds the new browser harness. No deployment or credentials are included.
- Package scripts `test:lesson-remedies` and `test:makeups-ui`; responsive browser harness under `artifacts/sikshya/scripts/makeups-ui`.

## Decisions and assumptions

- Monthly allowance is two teacher-approved courtesy replacements per paid 30-day tuition period; short courses allow one per ten purchased lessons rounded up, maximum three; single-lesson courses have no courtesy allowance. No rollover. Confirmed teacher non-delivery does not consume it.
- Pending courtesy requests reserve quota. Closing an unaccepted request releases that reservation; an accepted replacement remains reserved unless teacher non-delivery is confirmed.
- A replacement is private to its assigned student, has zero new tuition and remains linked to the original receipt/allocation. The affected allocation stays held while the case is pending or unresolved. Operator-confirmed delivery starts a fresh 48-hour review period, not immediate payout.
- Offer window is seven days, replacement window thirty days. Missed replacements go to human review; no automatic refund, forfeiture, AI financial decision or ban.
- `LESSON_REMEDIES_ENABLED=1` is the only new activation flag. Pausing new requests must not disable durable privacy, payment holds or existing case history.
- No blanket Preview merge. Preserve the premium owner Cost & Health dashboard, Production file signer, existing private-ID boundaries and existing teacher/student eligibility settings.

## Verification

- Backend reports API typecheck and esbuild build passed after local DB declaration refresh (`pnpm exec tsc --build lib/db`, no DB connection).
- `pnpm --filter @workspace/api-server run test`: 843/843 passed before the later reopen correction (which backend is testing separately).
- Final full API units after the reopen correction: 845/845 passed; final API typecheck passed. Backend focused policy/finance/schema/closure suite: 57/57 passed and API build passed.
- `pnpm --filter @workspace/sikshya run typecheck`: passed.
- `pnpm --filter @workspace/sikshya run test`: 622/622 passed.
- `pnpm --filter @workspace/sikshya run lint:design`: passed, no new token leaks (baseline 56 hex/211 raw sizes).
- `pnpm --filter @workspace/sikshya run test:makeups-ui`: 66/66 browser assertions passed across 320, 390 and 1440 widths. Includes durable retry key, quota reserve/full state, confirmed offers/operator evidence, disabled/paused/failure states and no horizontal overflow or browser exceptions. Synthetic only; screenshots in local temp `fadko-makeups-ui-G2bH0Z`.
- Actual screenshots `390-requested.png` and `1440-operator.png` were inspected: readable, bounded layout, bracketed filter counts, separate original/replacement/payment context and no overlap.
- `pnpm --filter @workspace/sikshya run test:class-home`: 50/50 passed at 390 and 1440, including expanded dates/history and existing exact lesson/help/earnings destinations; screenshots `fadko-class-home-BcY1On`.
- `pnpm --filter @workspace/sikshya run test:teaching-billing`: 24/24 passed; screenshots `fadko-teaching-billing-qybspr`.
- `git diff --check`: passed, CRLF conversion warnings only.
- New API/browser runner syntax checks (`node --check`): passed. Integrations added eight local-PG reopen assertions without overwriting the Production closure adaptation; final execution remains root's isolated gate.
- Additional `test:cost-health-ui` attempt could not run: its server expects `artifacts/sikshya/operator-web-build/index.html`, which is absent in this target checkout. No dashboard runtime change was made to bypass it; root owns the final export and live owner checks.
- Re-ran owner gate against root's fresh Production export using `COST_HEALTH_UI_BUILD=web-build`: 612/612 browser assertions passed at 320, 390, 768 and 1440 widths. Includes owner denial/no polling, revoked access, cooldown, partial/null cost truthfulness, grouped provider meters, exact budget settings, accessible controls and layout. Screenshots `sikshya-cost-health-7XIvZm`; 390/1440 overview images were visually inspected.
- Confirmed no frontend/runtime edits by this agent after root's fresh export; only test execution and this worklog evidence were added. Final diff review found no changes to fileStore/storage signer/routes or owner Cost & Health pages/components relative to `4bfb7e97`.
- Root owns readiness/live-smoke scripts; root reported both target schemas have dependencies/CREATE privilege and all three additive make-up tables are initially absent. These are readiness findings, not a deployed workflow or real end-to-end payment result.

## Problems and surprises

- Production is older than Preview foundation; copying all Preview ancestry would remove owner dashboard work and activate unrelated identity/closure behavior. Promotion uses minimal reviewed hunks instead.
- Full closure API checks cannot run in this intentionally narrower release. Only the read-only optional-table adapter and closed-account refusal fixture are included; full closure workflow is deferred.
- Preview real-PG make-up harness previously passed, but does not validate this assembled Production variant. Root must dispatch the fresh isolated PostgreSQL gate.
- Existing unit runs emit module-type warnings; they pass. No new package-level module-type change was made.
- The owner browser harness requires a separate operator export, not the local fixture bundles used by the new make-up checks. Its absent local index caused ENOENT; unchanged source and the prior root live owner checks are not a substitute for rerunning this optional check after the proper export.
- Helper initially generated a malformed apply_patch hunk and a Git path with `(admin)` was read without quoting. Both failed before any incorrect edits; corrected patch converter/path quoting used.

## Final release audit, continued

- Shared write/DTO reopening guard landed: eligible withdrawn or unaccepted review cases may re-request only while claim, quota, account, allocation and refund-review checks permit it. Accepted-at-ever replacements cannot chain.
- Final local API gate: 845 tests and typecheck passed. Fresh Production export retains the correct Production API; owner dashboard browser gate passed 612 assertions at 320/390/768/1440 widths.
- Additional root browser gates: profile 226, notifications 40, participant payment statements 90, in-class chat 17 and expanded call layout 308 assertions passed. These are isolated browser checks, not physical-device/media or real payment-provider tests.
- Isolated Production CI runs passed all 106 new PostgreSQL make-up checks and Programs checks. Old receipt fixtures expected hidden teacher fee breakdowns and active refunded seats. Corrected only those stale expectations: exact own-receipt hold/fee arithmetic, retained privacy exclusions, exact refunded seat/count and explicit room/socket denial. No runtime safety guard was relaxed.
- Production live-smoke preflight found no Preview staging accounts. Runner falls back only to bounded numeric repository seed definitions, proving the unchanged demo credential in memory before selecting two roles. No destructive seed code is imported or run; no account/booking/payment is created or changed, and no identifying data or credentials are printed. Preview retains strict staging-only selection.
- Follow-up CI 36753536294 at f89e1b5b passed booking 149, video 43, proof 125 and teaching access 26. Two old student-access fixtures collided with a previously booked lesson before reaching their intended payment-refusal probe; fixing only synthetic dates. A final review is hardening a pre-row-lock ordinary-booking interval and amount against concurrent teacher edits. Activation remains held for the corrected exact-source gate.

## Production API activation and final routing gate

- Full isolated CI 36755321981 passed at e9f626774fa0e3a89fe30af27a32559824e33a5e: API 849, app 622, new make-up PostgreSQL 121, Programs 607, bookings 149, video 43, proof 125, teacher access 26, student access 111; all configured browser gates passed.
- Set only LESSON_REMEDIES_ENABLED=1 on exact Production service be00bc18-98c7-4007-9ee4-9df080cdec8a. Uploaded the clean e9f62677 source; Railway deployment 090754ee-e14e-4d2a-b57f-7a79883bead4 reports SUCCESS.
- Live signed synthetic-role smoke passed: student and teacher 200/enabled, participant operator endpoints 403, anonymous make-up endpoint 401. Full live catalog check reports storage complete and dependencies ready. Identity collection and closure completion flags remain unset. Public readiness/programs 200; private owner endpoint 401 anonymously. These are read-only authorization/storage checks, not a real payment or full live request/offer/accept transaction.
- Actual exported app checks discovered an Expo public-URI collision between participant /makeups and grouped operator /makeups: operator refresh selected the participant page. Corrected the operator page to unique /operator-makeups in both branches; participant links remain unchanged. Added three source route regressions and a real-export, synthetic authenticated browser routing gate to CI. Final frontend release is held until fresh exports and this gate pass.
- Parallel local exports attempted by root collided in the shared Metro cache (EPERM); no deployed service failed. Preview export is completing first, then Production will be re-exported sequentially with correct explicit API targets. No cache bypass or runtime guard change was used.
- Sequential fresh exports passed: Preview all 130 chunks target staging; Production all 129 target Production, correct Fadko identity. Real-export routing checks passed 162 assertions in each target (direct/reload/dashboard/filter clearing, operator denial, mobile and desktop). Make-up UI passed 66 in each; fresh Production owner dashboard passed 612. Screenshots inspected without overlap.
- Full final CI 36758262874 and Preview 36758277477 cleared all server/database gates but failed the mobile class-setup tap in Linux. Trial actionability did not resolve it; diagnostic-only Preview bdb50a8d/CI 36760207815 captures trusted touch/click events and state. No application defect or test-driver cause is assumed until that trace is read. Worker publish remains held.
- Independent review found user-row-before-student-advisory lock inversion between make-up acceptance, ordinary booking and batch eligibility. Backend is applying a consistent advisory-before-user-row order with a deterministic PostgreSQL probe before the next API release. Existing financial, enrollment and closure guards remain mandatory.

## Exact-source gate follow-up

- Published synthetic program fixtures now explicitly use version 1, matching their frozen snapshot. Runtime listing-version validation was not relaxed. Production 51c8a259 / CI 36764603174 passed API 853, app 625, real PostgreSQL make-ups 143, programs 607, booking 149, video 43, proof 125, teacher access 26 and student access 111.
- Trusted mobile event diagnostics found a real test sequencing problem: the RNW date-picker fade-out restored focus/scroll after coordinates were sampled, so a later compatibility click landed on a different control. The test now waits for picker DOM detachment and consecutive-frame stable, hit-tested geometry before genuine touch input; no forced/JavaScript press, longer timeout, assertion removal or application workaround. Local Production class setup passed all 170 assertions. Final Linux gate remains required.
- The Preview gate at 54baa1e4 passed the new 145-check make-up suite, then encountered exact synthetic publication stubs left visible to the following catalog pagination suite. Harness cleanup now archives only its tracked local-disposable program IDs after API shutdown, preserving seats, receipts, cases and ledgers; public runtime guards are unchanged.
- A further independent audit found financial-dispute/support-handoff user-FK locks before the original-payment lock, opposite to make-up request/acceptance. The next narrowly reviewed correction must pre-lock the original payment before inserting a financial ticket and prove it with deterministic PostgreSQL races before release.
- Local Railway upload exclusions omit audit captures, static web exports, worklogs and local credentials. The tested frontend runtime remains unchanged since the fresh unique-operator-route exports.
- The final financial pre-lock correction is now independently reviewed and frozen in both sources. Added four deterministic direct-ticket/assistant-handoff versus request/acceptance PostgreSQL combinations, including exact original-payment waiters, proof of no prematurely acquired user-FK lock, one owned ticket, unchanged original amounts/seats/receipt and held human-review state. Local Production API 857/857, Preview API 888/888, both typechecks/builds and browser class setup 170/170 passed. The next exact-source CI must execute these new database probes and every later gate.

## Fabrications found

### Teardown correction after real financial-race execution

CI 36767488971 at 223c2537 passed all 163 PostgreSQL make-up assertions, including all four real financial-ticket/request/acceptance races. Its new fixture archiving teardown then correctly failed the immutable purchased-program trigger. No guard was bypassed. Replaced that cleanup with a visibility-only reset of existing profiles for exact synthetic teacher IDs created by this guarded disposable harness, after API shutdown. Published promises, seats, cases, receipts and ledger rows are untouched. A fresh full gate remains required.

### Fabrication review

None found in the promoted workflow. No new receipt, paid charge, automatic refund, inferred delivery from connection or fake earnings is created. Browser data is explicitly synthetic and not a live account result.

## Deliberately not changed

Purchases, live money/provider credentials, identity collection/student citizenship, account-closure completion/request API activation, Daily/LiveKit selection, owner dashboard, Production private-ID signer, unrelated teacher eligibility/foundation changes and published class creation retirement. No commit, push or deployment by this subagent. Regression worklog and static export/deployment remain root-owned.

## Remaining risks / next pickup point

This release is complete; the authoritative final evidence is below. Remaining validation is owner testing on physical iOS/Android devices and real payment-provider operation when separately activated. Replacements are currently assigned privately per student, not bulk whole-class rescheduling. No purchases or automatic refunds/bans were performed.

## September 30 release checkpoint (supersedes earlier pending status)

- Exact source fbfeae61ee1ad892b5bb5b701aff6eec306cb0e0 passed full CI 36768420498: API 857, app 625, isolated PostgreSQL make-ups 163, programs 607, booking 149, video 43, proof 125, teacher access 26, student access 111; browser 170/90/50/66/24 and actual-export route assertions 162. Raw job logs independently confirmed export completion and route runner execution; the aggregate gh log cut off at an oversized CSS warning.
- Railway deployment f6e19467-3b4b-4aa8-9065-7332318660ce is SUCCESS. Signed existing synthetic teacher/student reads returned 200/enabled; participant access to the operator desk returned 403 and anonymous history returned 401. Full live storage is complete and dependencies ready. Identity collection and closure-completion flags remain unset. No live account, booking, request, ticket or payment was created by release smoke checks.
- Preview source 9d0213109484651196a8783066025b791e1e9787 also passed full CI 36768446002 and API deployment 67a88e80-b80f-4835-b093-6bf626a335c7; only LESSON_REMEDIES_ENABLED=1 was activated there. Its three additive tables and signed-role/privacy checks passed.
- Fresh deployment exports passed 162 real-export route assertions again in both targets. The independent final link audit then caught one stale operator make-up notification destination; corrected to /(admin)/operator-makeups with original class/lesson context preserved, teacher/student /makeups unchanged, and direct regressions added. Frontend publication waits for fresh corrected exports and the final source gate. No unrelated runtime change or second API deployment is needed for this frontend-only correction.

## Final verified live release

- Production frontend source 70cb9505d4c666c3c08736fe05e6f4b6c28f8568 passed full CI 36771385545: API 857, app 626, PostgreSQL make-ups 163; all existing financial/access/browser gates and 162 actual Expo routing assertions passed. Independent raw job logs prove the export and runner executed. This differs from deployed API fbfeae61 only in frontend notification routing/tests and documentation, with no backend/database/schema delta.
- Fresh clean Production export verified all 129 JavaScript chunks against the exact Production API and Fadko identity, retained the premium owner workspace, rejected the retired operator path, and again passed 162 mobile/desktop direct/reload/role routing assertions. Worker hometuition version ea222abd-588a-4b06-a89a-ba455f747fbf is live at https://hometuition.praksh-dhakal.workers.dev.
- Post-publication verification passed for served HTML and every one of the 129 exact chunk hashes/API targets. The owner Cost & Health page serves the exact three entry/shared bundles, preserves the premium dashboard and rejects anonymous owner-data access (401). Public API readiness and programs returned 200. Production Railway remains f6e19467-3b4b-4aa8-9065-7332318660ce, SUCCESS.
- Preview frontend source b63a8938318219f31bdad949ef45d6e8555ab6e8 passed full CI 36771385492 (API 888, app 635, PostgreSQL 165 and all downstream gates). Fresh Preview export and 162 local routing assertions passed; Worker hometuition-preview version a5da37b3-fa8a-4b14-9a08-687269a5e6c2 is live, with all 130 served chunk hashes and the isolated staging API verified. Preview Railway remains 67a88e80-b80f-4835-b093-6bf626a335c7, SUCCESS.
- Only the make-up flag is enabled in both services; complete additive storage, participant/operator separation and anonymous privacy passed signed synthetic-role smoke. No real money, refund, ticket, make-up request/acceptance or account was created by live deployment verification; complete transaction/race coverage ran against isolated disposable PostgreSQL, not shared live data.
- Owner test path: Classes -> choose class -> Make-up lessons (or Make-up options beside an eligible original lesson). Student requests and sees reserved/remaining allowance; teacher offers a Nepal-time replacement; student accepts; original receipt/allocation remains linked and held. Operator evidence-confirmed delivery starts a fresh 48-hour review period. Missed replacements go to human review; no second tuition, automatic refund or inferred attendance.
- No blanket main/Preview merge, provider switch, private-ID activation, account-closure completion, purchase or billing-plan change. Historical pending checkpoints above are superseded by this final section.
