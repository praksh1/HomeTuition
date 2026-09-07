# Learning Program and managed-marketplace foundation

- Date: 2026-09-07
- Agent: Codex
- Branch: codex/learning-program-foundation
- Base commit: a58f23f
- Status: implementation and verification in progress

## Requested

Help design and build the Xueersi-inspired but Nepal-appropriate structured learning journey and
managed-marketplace payment model; keep entry simple for teachers and students; make the product
feel premium; split independent work while Claude continues the isolated LiveKit classroom pilot.

## Changed

- Added a durable product/architecture backlog defining the flexible learning-program model,
  managed-marketplace ledger, lesson allocations, weekly payout direction, premium journeys,
  phased delivery and unresolved real-money decisions.
- Added the approved direction to cross-agent memory and its index.
- Added a pure, provider-independent Learning Program publish contract with five templates and
  realistic Nepal pilots for Grade 10 Mathematics, beginner guitar, spoken English and engineering
  registration exam preparation. It requires honest outcomes and exact exam references without
  forcing skill/language teachers through school fields.
- Added a durable, tightly bounded handoff for Claude's later Phase 1 schema/read-API task. It is
  explicitly blocked from touching payments, booking, membership, classrooms or production.
- Replaced the shared `PaymentSheet` credential form with an honest provider-selection sheet.
- Removed the wallet mobile-number and MPIN fields, unsupported security claims, and false receipt
  language. Preserved the existing server-owned acceptance/refusal callback.
- Updated browser journeys that formerly typed fake wallet credentials and added a source-contract
  test preventing credential collection and invented receipts from quietly returning.
- No schema, API, provider or production configuration changed.

## Decisions and assumptions

- Structured learning is a flexible container, not a national-curriculum restriction.
- Student product, teacher commercial plan and payout status use different names.
- Existing recurring/session records are preserved; a future program parent is additive and
  versioned.
- The internal ledger is not escrow and cannot move real money until a licensed provider's actual
  settlement capabilities and Nepal advice are confirmed.
- Premium is expressed through hierarchy, typography, spacing, honest state and responsiveness,
  not heavy visual effects.

## Verification

- Read `CLAUDE.md`, `.agents/memory/MEMORY.md`, `HANDOVER.md`, `DESIGN.md`, `REFUNDS.md`, the
  existing teacher-pricing proposal, worklog format, and current monthly/payment/refund schemas and
  payment adapter.
- `pnpm run typecheck`: passed across all four workspaces after the UI change.
- `pnpm --filter @workspace/sikshya run test`: 261 passed, 0 failed, including 3 new
  payment-safety contract tests.
- Focused Learning Program contract: 7 passed, 0 failed.
- Full API unit suite: 439 passed, 1 failed. The only failure is the existing
  `socialIdentity.test.ts` loader failing to resolve the installed `jose` package; it occurs before
  that test executes and no dependency or social-identity file changed here.
- `lint:design:update`: passed and lowered the repository baseline to 94 hex literals and 282 raw
  font sizes. `PaymentSheet.tsx` improved from 5→0 hex and 12→0 raw font sizes.
- Static web export compiled all 3,975 modules and produced `web-build`, but the existing
  post-build target-integrity assertion did not find the expected quoted localhost address even
  though the generated bundle contains `localhost:8081`. The first sandboxed attempt also hit an
  EPERM reading Expo's Apple-auth plugin; the escalated retry resolved that and reached the
  separate target assertion. No build script, dependency or auth configuration was changed.

## Problems and surprises

- Creating the branch initially failed because the sandbox could not write Git refs; the approved
  escalated Git operation created the isolated branch successfully.
- Existing code contains two separate products currently described as monthly: a teacher platform
  tier and a recurring student course. The name collision is a real source of product confusion.
- Real gateway mode deliberately refuses payment because no provider implementation exists. The
  current refund table records money owed but does not send it.
- The current future-gateway flow has a structural mismatch: the gateway booking path creates no
  enrolment, but the generic webhook expects an enrolment to already exist. A real integration
  therefore needs a separate order and seat-hold model, with access created only after a verified,
  idempotent provider confirmation.
- Existing enrolment rows currently mix access and payment state, while there is no immutable
  teacher-payable or payout ledger. These must be additive structures, not extra meanings packed
  into the current status fields.

## Fabrications found

- None newly introduced or confirmed in the application during this documentation pass. Existing
  documented simulated-payment and historical fake-payment-state findings remain unchanged.

## Deliberately not changed

- Claude's LiveKit branch and classroom work.
- Database schema, migrations, production data and environment variables.
- Prices, fees, commission, payout/refund deadlines and tax treatment.
- Existing recurring purchases, booking atomicity, membership and refund behavior.
- No deployment, merge, provider activation, account change or purchase.
- No real eSewa, Khalti, bank, payout, refund or webhook integration.
- No production preview was created for this isolated foundation, and the new payment surface has
  not yet been manually inspected on a real Android phone or iPhone.

## Remaining risks / next pickup point

- Claude can take the bounded Phase 1 learning-program schema/read API after its isolated LiveKit
  pilot is reviewed. It must not touch payment, booking, membership or production deployment.
- Codex should next review that implementation, then build the teacher draft/preview journey and
  four realistic program fixtures before any schema reaches production.
- Confirm marketplace settlement with an NRB-licensed provider and Nepal lawyer/accountant before
  implementing real custody, payouts or public financial promises.
