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
- API unit suite: 868 passed after the independent stored-policy, acceptance replay and schema-readiness review patches.
- PostgreSQL harness files: JavaScript syntax checks passed. Real transactions have not yet been executed locally because this host has no PostgreSQL/container runtime; root owns the PostgreSQL 16 CI run.
- Git diff whitespace check: passed.

## Safety and omissions

No deployment, shared database mutation, migration, commit, purchase, actual payment/refund transfer, AI verdict, automatic refund or automatic forfeiture performed by this agent. Production promotion and staged activation remain with the root agent. The LiveKit media provider itself was not changed. Existing paid commitments are preserved when new make-up creation is paused.

## Remaining

Run actual PostgreSQL race/integration checks and fix any failures before activation. The real HTTP harness also checks an exact acceptance retry after refund returns its saved link without restoring either revoked seat. Root owns UI, PostgreSQL CI, Production promotion and activation.
