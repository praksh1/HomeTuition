# Support knowledge library and payment evidence

- Date: 2026-09-24
- Agent: Codex
- Branch: codex/support-investigation-sep24
- Base commit: db68eec
- Status: in progress

## Requested
Continue with the reviewed knowledge base and payment-evidence workflow. Keep production support paused; no purchases, AI refunds or bans.

## Changed
- Ten versioned, source-linked starter guides. Admin-only transactional import creates drafts, skips existing slugs, never overwrites edits or publishes. Imports are audited. Existing review/publish/archive controls remain authoritative.
- Help Library gets import, search and a pre-publication checklist in its responsive editor. Modified articles do not claim unchanged starter provenance.
- Selected lesson context reads only the requesting student's enrollment, matching frozen batch test receipt and own lesson refund rows. References, operator notes, other students' records, and platform shares are excluded. Teacher context does not expose student finances.
- Pure payment interpreter distinguishes test/SIM records, course total versus lesson allocation, refund owed versus locally marked paid. No provider settlement claim or money mutation.
- Linked payment investigations skip asking for the class again. Bounded human summaries preserve financial/abuse uncertainty disclaimers even when clipped.

## Decisions and assumptions
The first payment evidence slice covers session-linked enrollment/refunds and batch simulation receipts. It is not provider reconciliation, aggregate teacher earnings, recurring refunds without a lesson, or all historical learning-program shadow ledgers. Those need explicit mapping rather than guessed joins.
Starter answers are drafts until an operator reviews and publishes. No new policy, refund deadline or guarantee is introduced. Existing server-side editor roles and audit trail are reused.

## Verification
Pure payment/content/investigation tests pass locally; source-reference existence is tested. Design lint passes without baseline changes. Expanded phone/laptop browser checks and clean-install API integration/typecheck are running; record final results below.

## Problems and surprises
Local API typecheck still lacks jose/livekit-server-sdk in the shared dependency tree; use clean-install CI, not a false green. Initial browser bundling was blocked by Windows sandbox directory access; rerun with approved escalation reached and passed the new phone checks.

## Fabrications found
No new invented facts. Explicitly prevents treating legacy paid SIM enrollment or a locally marked-paid refund as independent provider confirmation.

## Deliberately not changed
Production, provider credentials/billing, classroom follow-ups, live user records, refunds/payouts/bans, recording/vision analysis. No auto-publication of starter content.

## Remaining risks / next pickup point
Verify fresh-install CI and rendered phone/laptop editor. Then deploy matching staging API and frontend together through the existing isolated gates, never frontend-only against old routes. Review/publish starter content using synthetic accounts, evaluate real provider answers separately, and complete provider/payment reconciliation before claiming full automation.
