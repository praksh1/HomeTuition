# Cost analysis and queued learning release

- Date: 2026-09-24
- Agent: Codex
- Branch: codex/queued-learning-release
- Base commit: e6a27c9
- Status: in progress

## Requested
Compare near-zero-cost LiveKit hosting without an existing server/domain. Complete and deploy the queued product work, preserving no-purchases and existing financial safeguards.

## Changed
In progress: current-source cost report; signed-in shared-tab reload routing; quiz groundwork and release checks.

## Decisions and assumptions
Production remains on LiveKit Cloud. Self-host kit stays on its separate preview branch. No account, server, domain or paid provider purchase. Make-up rules remain a proposal until the owner answers the specific policy choice; no automatic refund or ban.

## Verification
Pending implementation and tests.

## Problems and surprises
Current Oracle documentation says 2 OCPUs/12 GB, not the older often-quoted 4/24. Hetzner published changed prices in June 2026; do not reuse older quotes.

## Fabrications found
None. Capacity examples in the cost report are estimates, not load-test results.

## Deliberately not changed
LiveKit production credentials/provider; financial entitlements; consumer AI accounts; classroom production layout.

## Remaining risks / next pickup point
Verify live deployment and exact tests before reporting completion. New quiz tables must be applied safely before activating routes. Separate external-account/privacy/policy prerequisites from buildable queue items.
