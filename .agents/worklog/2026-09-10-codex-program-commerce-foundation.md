# Learning Program commerce foundation

- Date: 2026-09-10
- Agent: Codex
- Branch: `codex/program-commerce-foundation`
- Base commit: `0ff5a40`
- Status: in progress

## Requested

Proceed to the phase after the owner accepted Programs on teacher profiles in production. Connect
the Learning Program direction to payments without confusing teachers or students and without
inventing unapproved financial terms.

## Changed

- Added a provider/database-independent lesson-allocation calculator.
- Added an explicit state machine for future, replacement-pending, delivered-pending, disputed,
  eligible, paid-out, refund-owed and refunded allocations.
- Added exhaustive unit scenarios for rounding, conservation of tuition, disputes, cancellations,
  payout eligibility and terminal states.
- Added `PROGRAM-COMMERCE.md`, written for owner, engineer and future agent, separating student
  purchases from teacher commercial plans and listing every unresolved commercial decision.
- Added an owner-decision recommendation (Flexible-only launch, one student total, per-lesson
  complaint freeze, replacement-before-refund and weekly eligibility) without filling any rate.
- Checked current NRB, Khalti and eSewa primary material and recorded exactly what their public
  contracts establish—and what they do not establish about marketplace settlement.

## Decisions and assumptions

- Existing NPR money columns represent whole rupees. This foundation uses that unit and refuses to
  silently reinterpret it as paisa.
- A confirmed Program tuition amount is allocated lesson by lesson, with deterministic remainder
  handling and exact conservation of the confirmed total.
- Evidence never makes a refund decision and cannot transition an allocation directly.
- A provider confirmation, not a UI action or API acceptance, completes a payout or refund.

## Verification

- Focused `programCommerce.test.ts`: 20 passed, 0 failed.
- `pnpm run typecheck`: passed across all four workspace packages when run with access to the
  installed dependency junctions.
- API unit suite: 494 passed, 0 failed, including the 20 new scenarios.
- `git diff --check`: passed before final documentation review.

## Problems and surprises

- Creating the branch initially failed inside the filesystem sandbox because `.git/refs/heads`
  was not writable there. Re-running the ordinary `git switch -c` with repository permission
  created the isolated branch; no work was lost.
- The first state-machine draft moved a cancelled future lesson straight to `refund_owed`. Review
  caught that this contradicted the approved replacement-or-refund policy and would let a
  cancellation choose its own remedy. The final model uses `replacement_pending`; a valid make-up
  reuses the same allocation, while a separately approved refund creates the debt.
- The package-only typecheck inside the restricted Windows sandbox reported `jose` and
  `livekit-server-sdk` missing. This is the documented workspace-junction false failure; the full
  repository typecheck with dependency access passed all four packages.
- Khalti's public merchant terms directly undermine the idea that app copy can make Fadko
  categorically uninvolved in refunds: they place service-quality disputes on the merchant. The
  exact merchant-of-record and teacher-recovery arrangement therefore remains a provider/legal
  decision, not a disclaimer to code.

## Fabrications found

None in the product UI. The existing Monthly model still contains an approved 30% platform share;
this work deliberately does not copy that number into Learning Programs, where no rate is approved.

## Deliberately not changed

- No schema, route, screen, checkout, provider, payment, refund, payout, booking, membership,
  Monthly-class, Single-Class, Daily, LiveKit or classroom change.
- No production or staging data and no third-party account.
- No commission, fee, complaint window, payout day or price default.

## Remaining risks / next pickup point

1. Run focused and repository gates and review the state vocabulary against every approved product
   rule.
2. Convert the ten unresolved decisions in `PROGRAM-COMMERCE.md` into an owner decision packet.
3. Only after approval, add new tables alongside current commerce and start with simulated/test
   enrolment. Do not route production money through this foundation.
