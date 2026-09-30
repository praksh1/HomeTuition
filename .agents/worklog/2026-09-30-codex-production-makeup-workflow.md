# Scoped Production make-up workflow promotion

- Date: 2026-09-30
- Agent: Codex production_promotion, with makeup_backend and makeup_integrations
- Branch: codex/production-makeup-workflow-sep30
- Base commit: 4bfb7e979c0f08eae5a88de5393deccc597a05f8
- Status: in progress

## Requested

Complete the approved linked make-up request, teacher assignment, student acceptance, quota display and original-payment hold workflow. Promote only reviewed dependencies to the Production branch after the separate regression release. Root owns commit, push, deployment and live verification.

## Changed

- New policy/core/schema/view/router modules and focused tests under `artifacts/api-server/src/lib/lessonRemedy*`, `makeupPolicy*`, `lessonRemedies*`, `routes/lessonRemedies.ts` and `lib/db/src/schema/lessonRemedies.ts`. Core modules originate from reviewed Preview source `8837e78b`; backend owns its later reopen-DTO correction.
- A narrow read-only `accountClosureStatus` adapter permits older deployments without a closure table, while installed closed-account rows and query failures remain authoritative. This does not install or activate closure or identity collection APIs.
- Targeted membership/session allowance/session ownership, replacement privacy, shared overlap locks, immutable seat/refund guards, ledger transitions, original-allocation holds, refund/payout decisions, support context and notification integration hunks. Ordinary identity and LiveKit provider settings are unchanged.
- Participant `makeups.tsx` and operator `(admin)/makeups.tsx` use the shared `MakeupsWorkspace`; class home, lesson details and original receipt statements link to the exact original/replacement lesson. Operator desk navigation and make-up notification routing are registered.
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

## Fabrications found

None found in the promoted workflow. No new receipt, paid charge, automatic refund, inferred delivery from connection or fake earnings is created. Browser data is explicitly synthetic and not a live account result.

## Deliberately not changed

Purchases, live money/provider credentials, identity collection/student citizenship, account-closure completion/request API activation, Daily/LiveKit selection, owner dashboard, Production private-ID signer, unrelated teacher eligibility/foundation changes and published class creation retirement. No commit, push or deployment by this subagent. Regression worklog and static export/deployment remain root-owned.

## Remaining risks / next pickup point

Backend/integrations completed the small withdrawn/review case reopening projection and its real-PG assertions in both sources. Runtime is frozen and final local unit/type/owner browser gates passed. Root must run the assembled-variant PostgreSQL gate, complete exact Production export/hash and owner/privacy checks, then enable only the make-up flag and verify signed synthetic-role reads. Do not report the follow-on live until those gates pass. Live phone teacher/student interaction and real payment-provider operation remain separate owner/provider testing.
