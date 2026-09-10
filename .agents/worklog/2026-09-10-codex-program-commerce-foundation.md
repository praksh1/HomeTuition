# Learning Program commerce foundation

- Date: 2026-09-10
- Agent: Codex
- Branch: `codex/program-commerce-foundation`
- Base commit: `0ff5a40`
- Status: shadow ledger and rehearsal UI implemented; preview deployment pending

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
- After owner approval, recorded the nine beta rules in durable memory and this commerce contract.
- Added three new, isolated tables for simulated Program enrolments, lesson allocations and an
  append-only decision history. Existing tables and columns were not changed.
- Added an operator-only test-enrolment route. It requires a live student test grant, records
  `test_confirmed` rather than `paid`, leaves the provider reference null and says no payment moved.
- Added an operator-only allocation transition route through the tested state machine; complaint
  and refund decisions require a written reason.
- Added read-only teacher statement, operator reconciliation and student-own-test-place endpoints.
- Extended the existing schema-parity gate to cover all five Program tables, their indexes and all
  eight foreign keys.
- Added a teacher `Money rehearsal` statement reached from Programs, separating every allocation
  state and labelling every figure as test-only and not payable.
- Added an operator Programs tab that selects a published Program and an approved test student,
  creates the simulated enrolment, and rehearses each allowed lesson transition with required
  reasons for complaint/refund decisions.
- Added a student Program-page state that shows frozen rehearsal terms when the signed-in student
  has a test place. A failed private lookup says it could not check rather than falsely saying the
  student has no place.

## Decisions and assumptions

- Existing NPR money columns represent whole rupees. This foundation uses that unit and refuses to
  silently reinterpret it as paisa.
- A confirmed Program tuition amount is allocated lesson by lesson, with deterministic remainder
  handling and exact conservation of the confirmed total.
- Evidence never makes a refund decision and cannot transition an allocation directly.
- A provider confirmation, not a UI action or API acceptance, completes a payout or refund.
- Approved beta terms: Flexible-only launch; 70% teacher / 30% Fadko; no separate student fee;
  48-hour complaint window; only the affected lesson freezes; replacement before an approved
  affected-lesson refund; provisional Wednesday payout; current Monthly and Single Class unchanged.

## Verification

- Focused commerce scenarios: 21 passed, 0 failed, including exact 70/30 conservation.
- `pnpm run typecheck`: passed across all four workspace packages when run with access to the
  installed dependency junctions.
- API unit suite: 495 passed, 0 failed, including the 21 commerce scenarios.
- Sikshya unit suite passed after the UI changes.
- Design ratchet: 94 hex / 282 raw font sizes, unchanged; no new leaks.
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
- The first Programs integration attempt ran a stale API bundle and never came up. Rebuilding the
  API fixed startup. The second reached the test harness, then stopped because this Windows host
  has no `psql` executable. CI installs PostgreSQL client and owns the real schema-parity result;
  do not describe that integration suite as passed locally.
- A first statement query displayed the program's editable current title beside frozen purchase
  terms. Corrected it to read the snapshotted title, so a later edit cannot rewrite history.
- The first operator picker prefilled paid lesson count from the number of editorial Program steps.
  Those are not the same fact. Removed the inference; the operator must enter the rehearsal's paid
  lesson count explicitly.
- The first CI parity run proved every new column and index matched, then failed because I counted
  eight foreign keys in the assertion where the five-table schema correctly has nine (two original,
  three enrolment, one allocation, three ledger). Corrected the expected count; no product schema
  changed.

## Fabrications found

None in the product UI. The shadow ledger is repeatedly labelled test-only and cannot claim a
gateway payment, refund or payout occurred.

## Deliberately not changed

- No screen, checkout, provider, real payment, real refund, real payout, booking, membership,
  Monthly-class, Single-Class, Daily, LiveKit or classroom change.
- No existing database table or column changed, and no `db:push` was run.
- No production or staging data and no third-party account.
- No gateway credentials, production provider or teacher-set Program price was added.

## Remaining risks / next pickup point

1. Push the UI slice and let CI run the PostgreSQL schema-parity suite unavailable locally.
2. Deploy a staging preview, seed one approved test Program enrolment, and give the owner exact
   teacher/student/operator pages to inspect before any production merge.
3. Do not connect a gateway until provider/legal questions in `PROGRAM-COMMERCE.md` are resolved.
