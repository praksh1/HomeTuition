# Support case workspace continuation

- Date: 2026-09-26
- Agent: Codex
- Branch: codex/support-case-workspace
- Base commit: 2e81c66
- Status: in progress

## Requested
Continue pending Fadko tasks. DigitalOcean purchase is deferred until nearer public launch; keep existing LiveKit Cloud production unchanged.

## Changed
Operator ticket detail now has Overview, Class records, Timeline and Decision sections. The overview labels the report as a report, surfaces missing linked lesson/attendance/narrative evidence, and preserves human-only decisions. Notes survive section changes. Failed fetches can be retried; stale reads are ignored after focus/route cleanup. Decision buttons wrap on phones. Existing ticket/navigation integration journeys follow the new sections. A new isolated phone/laptop browser suite is included in test:tickets.

## Decisions and assumptions
This is the operator-workspace backlog slice, not deeper device diagnostics, model training, or an autonomous support completion claim. Existing API authorization, audited mutations, refund policy and provider settings are unchanged. No purchases.

## Verification
Workspace typecheck passed. App unit suite: 568 passed. Browser suite: 34 passed at 390/1440 widths, mocked synthetic ticket data, including a final rerun after the layout correction. Design lint passed without baseline changes. Phone screenshot inspected; caught an oversized refund button caused by a wrapping-layout basis and corrected it. Real API ticket/navigation journeys require their CI database and were not run locally. Non-deploying support workflow extended to the isolated branch and new browser suite; full release gate remains required before promotion.

## Problems and surprises
Normal shell fails before starting with sandbox-helper setup error; approved escalated commands work. Browser harness works despite earlier interactive browser runtime issues. Handoff contains historical product descriptions, so current backlog/worklogs govern release status.

## Fabrications found
An empty attendance result was labelled Nobody opened this class. Changed to explicitly state that no entries returned is not proof nobody attended.

## Deliberately not changed
Live deployment, server purchase, AI-provider activation, private-guide publication, financial/remedy policy, refunds/bans, private evidence transmission and native video migration.

## Remaining risks / next pickup point
Finish final browser rerun and review. Then commit and run full deployment gates before production promotion. Make-up policy still needs owner agreement; support guide review, deeper diagnostics, consented evidence analysis and provider reconciliation remain open. No claim all pending work is complete.
