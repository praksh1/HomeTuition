# Make-up finance, access and lifecycle integrations

- Date: 2026-09-30
- Agent: codex / makeup_integrations
- Branch: codex/preview-journey-fixes-sep29 (shared active worktree)
- Status: implementation and local checks complete; disposable PostgreSQL CI pending

## Requested

Complete the approved make-up workflow without a second charge or earning, preserve the original allocation and private class context, and prevent payment/review/closure bypasses.

## Changed

- Added durable accepted-replacement identity and original-allocation projection helpers. Replacement schedules/details are private, excluded before public pagination, and cannot be separately booked, edited into a new sale, or refunded at their zero price.
- Replacement classroom access follows the original allocation; class materials and class-home linkage survive the original paid period without a renewal. Refund approval revokes both original and replacement seats.
- Settlement loads the real case and accepted replacement. A Completed label or brief teacher join never confirms replacement delivery; documented operator confirmation starts a fresh 48-hour clock. Generic ledger actions cannot fabricate that confirmation or release a held case.
- Financial Support tickets naming either original or replacement freeze the original allocation. An explicit separate human refund-denial recovery preserves the previously confirmed review clock, rather than granting instant payout or implicitly denying an open complaint.
- Receipt projections include private-safe make-up links, exact original held amounts and zero additional charge. Both teacher/student aggregates count all nonterminal allocations. Current receipts are simulations: actual money moved remains zero.
- Explicit payout after confirmed replacement review finalizes the case. Account closure does not double-count a case and its allocation, and recognizes documented settled fulfillment without leaving a permanent pending-make-up blocker.
- Refunded history uses a historical reader, not enrollment permission. Teacher/operator queues select existing cases before their limit and sort active first; students prioritize active records. Responses explicitly declare truncation.
- Added a disposable PostgreSQL HTTP assertion module covering money/access/privacy, after-period classroom access, financial recovery, settled closure, row-cap behavior and restricted operator read routes. The harness refuses remote/shared database URLs, neutralizes service credentials, and uses echo video with no real money or emails.

## Verification

- API TypeScript check: passed.
- API build: passed.
- API unit suite: 874 passed after stored-policy, acceptance replay, schema-readiness, enrollment trigger and lock-order review patches.
- PostgreSQL harness files: JavaScript syntax checks passed. Real transactions have not yet been executed locally because this host has no PostgreSQL/container runtime; root owns the PostgreSQL 16 CI run.
- Git diff whitespace check: passed.

## Safety and omissions

No deployment, shared database mutation, migration, commit, purchase, actual payment/refund transfer, AI verdict, automatic refund or automatic forfeiture performed by this agent. Production promotion and staged activation remain with the root agent. The LiveKit media provider itself was not changed. Existing paid commitments are preserved when new make-up creation is paused.

## Remaining

Run actual PostgreSQL race/integration checks and fix any failures before activation. The real HTTP harness also checks an exact acceptance retry after refund returns its saved link without restoring either revoked seat. Root owns UI, PostgreSQL CI, Production promotion and activation.

## First PostgreSQL CI diagnosis

- Run 36744550519 passed dependency install, aggregate TypeScript, API/UI unit tests, design lint, fresh schema push and API build. Its first fixture failed with `BATCH_TEST_BOOKING_REQUIRED`: synthetic fixture enrollment used a method different from the real `test_access` contract.
- The same existing trigger also prohibited real workflow revocation `test -> refunded`. Added a narrow exception only for unchanged original seat identity, retained `test_access`/null payment reference, and the latest exact original allocation ledger in `refund_owed`/`refunded`. New paid/refunded enrollment inserts remain forbidden.
- Protected the mapped OLD identity so a seat cannot move to an unmapped session or another booked student, and a refunded seat cannot be resurrected. Added five focused SQL guard tests and real PostgreSQL negative assertions; the fixture now mirrors the real test enrollment method.
- Independent backend review also fixed offer/accept's teacher-advisory-before-user-row lock order to match normal booking. Deterministic PostgreSQL tests hold that advisory while checking user-row availability for both operations, with bounded waits and rollback/release cleanup. Root must rerun PostgreSQL CI; no live database or deployment changes were made here.
