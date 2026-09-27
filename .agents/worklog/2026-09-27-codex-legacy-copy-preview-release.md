# Legacy billing and Preview copy release

- Date: 2026-09-27
- Agent: Codex
- Branch: `codex/support-case-workspace`
- Base commit: `1f0c560`
- Status: complete for this Preview release; make-up workflow remains open

## Requested

Verify old teacher-paid plans are not sold or shown in the active flow, improve wording and capitalization, deploy for testing, and report whether make-up classes are integrated.

## Changed

- Tightened the active teacher earnings page: one clear student-paid tuition and 70/30 explanation, no repeated legacy-plan language, and no bank-transfer promise.
- Removed premature make-up automation claims from teacher and student payment summaries. The current path is manual Support review until a linked in-app workflow exists.
- Clarified Profile, header and class-home earnings labels as lesson earnings, holds and receipts.
- Aligned the phone/laptop billing browser check with the new payout explanation.
- Added an explicit root API start script and `railpack.json` scoped API build because Railway Railpack 0.40.0 did not honor the monorepo's intended build/start configuration from the local upload. Added `.railwayignore` to exclude generated web exports and local audit captures from API upload.

## Decisions and assumptions

- Deployed only the existing Preview Worker and `hometuition-api-staging` service, not the production Worker/API. No purchases, real payment provider, identity collection, closure, or operator cutover were enabled.
- Existing purchased Monthly and standalone teaching contracts remain in code and accessible to their owners; new teacher-plan sales and new standalone creation remain blocked outside isolated tests. The archived picker is not the active earnings page.
- The approved new make-up policy is not a feature launch. Its validator and a ledger guard are present, but request/offer/acceptance/replacement/payout linkage are not.

## Verification

- Workspace typecheck passed. API build and 787 API unit tests passed.
- Teacher billing browser checks: 36 passed at 390/1440 widths. Profile browser checks: 256 passed. Class setup: 115 passed. Practice booking: 90 passed. Design lint passed. Legacy-plan and make-up policy focused tests: 9 passed.
- `test:nav` was not run end to end: no local API at `127.0.0.1:8080`.
- Staging database schema push reported changes applied. Staging API deployment `a5ea4dbc-f2a2-4095-857e-50edf057833d` reached SUCCESS and `/api/readyz` returned `{"status":"ok"}`.
- A final API guard also hides retired tiers from deployed clients. Staging API deployment `fb6424f9-c992-48f0-8724-22be61ad06d5` reached SUCCESS; live `GET /api/subscription-tiers` returned `{ "tiers": [], "legacyPlanSalesOpen": false }`, and `/api/readyz` remained healthy.
- Web build verified its baked-in staging API address and Fadko title. No production API hostname was found in the bundle. Wrangler Preview dry run passed. Worker version `299b7ed1-b06e-4c1f-ae0d-235008bf51d5` deployed at `https://hometuition-preview.praksh-dhakal.workers.dev`; `scripts/verify-preview.mjs` matched served HTML and three exact bundles to the local build and staging API.

## Problems and surprises

- Initial Railway upload failed because Railpack found no root start command. A second upload detected the root start but ran the broad workspace build and failed in the unrelated mockup sandbox for a missing `PORT`. Scoped `railpack.json` fixed the staging API build.
- Staging service lives in a Railway environment named `production` inside the project; the explicit service target was `hometuition-api-staging` (id `cc10a94f-b24b-47bc-ae5c-ec2a9307cfa0`). The separate production API service was not targeted.
- The worktree contains broad prior identity, operator, commerce and classroom edits. This release verified key gates and isolation but was not a full paired-account or physical-device acceptance test.

## Fabrications found

- Payment-summary copy implied an unfinished make-up could already hold an affected payout through an integrated process. That workflow does not exist yet; copy now names the manual Support route.

## Deliberately not changed

- No historic monthly contract, database row or archived plan code was deleted or repriced.
- No real charge/refund/payout, automatic make-up decision, payout cadence, identity collection or operator login cutover was activated.
- No production deployment, main merge or release claim was made.

## Remaining risks / next pickup point

1. Build the approved make-up flow with durable original lesson and booking linkage, seven-day teacher offer/acceptance, replacement within thirty days, payout hold, manual review and refund path; test concurrency and expiry.
2. Run real paired Preview teacher/student/operator journeys through signup, class publication, simulated booking, attendance, dispute and receipt. The current browser checks are mostly fixtures.
3. Confirm large-phone Safari/Android and R2-backed class-material behavior on real devices. Do not enable real payments or private identity collection based on this Preview release alone.
