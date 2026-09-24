# LiveKit self-hosted preview preparation

- Date: 2026-09-24
- Agent: Codex
- Branch: codex/livekit-self-host-preview
- Base commit: e6a27c9d737645d09e3efb543837cf35a8e76ef2
- Status: in progress

## Requested

Prepare self-hosted LiveKit in preview so the owner can learn/manage it before any future Cloud
replacement. Preserve current architecture and the earlier queued product items. No purchases.

## Changed

Added `infra/livekit-preview/`: private configuration generator, two-container VM setup, constrained
Linux operation helper, bounded read-only API diagnostic, local tests, real-server smoke test and
founder/operator runbook. Added a feature-branch-only verification workflow with no deployment.

## Decisions and assumptions

"Self Serve" interpreted as self-hosted LiveKit. One Linux VM initially; existing SDK/provider seam
and Fadko backend remain. Production and current preview Cloud credentials are untouched. Preview
domains/keys/namespace isolated. No silent mid-call failover or automatic updates. Native apps have
a separate current Daily path; browser tests are not native SDK tests.

## Verification

Local generator/probe suite: 21 passing checks. Public host/TLS/media tests not yet possible.
CI verification pending. No Docker Engine, Go or usable WSL installation found on this Windows host;
the Linux/real-server checks will use a disposable GitHub runner, not production.

## Problems and surprises

Older CLAUDE/VIDEO documents describe Daily as the deployed provider despite the current accepted
LiveKit Cloud release. Inspected the implementation rather than using those stale deployment claims.
Existing provider accepts arbitrary configured LiveKit hosts; a new provider/rewrite is unnecessary.
Current credentials diagnostic copy is Cloud-centric; the private preview probe is host-neutral.
One broad PowerShell `rg` wildcard path failed; explicit directory/file paths used instead.

## Fabrications found

No new fabricated UI data. No claim that self-hosting is free, deployed, carrier-tested or inherently
cheaper. A healthy HTTP endpoint is explicitly not proof of working video/TURN.

## Deliberately not changed

Production, current preview provider, Railway variables, DNS, secrets, databases, payment logic,
whiteboard/chat UX, native video SDKs, recordings, make-up policy and quiz backlog.

## Remaining risks / next pickup point

Need owner's available Linux VM/provider, preview subdomains and any hosting budget decision before
activation. An async question was sent; preparation proceeds independently. Validate pinned containers,
generated SFU startup and existing real-media regressions, then record results. Once a host is chosen,
verify firewall/TLS/TURN from external devices, stage only the staging variables in one deploy, and
rehearse rollback. The queued product work is linked in the runbook and existing backlog, not lost.
