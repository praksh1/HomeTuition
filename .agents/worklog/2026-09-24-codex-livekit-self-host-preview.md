# LiveKit self-hosted preview preparation

- Date: 2026-09-24
- Agent: Codex
- Branch: codex/livekit-self-host-preview
- Base commit: e6a27c9d737645d09e3efb543837cf35a8e76ef2
- Status: blocked (preparation verified; public activation awaits host/domain choice)

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

Local generator/probe suite: 21 passing checks; `git diff --check` passed.
Final tested implementation commit: `05ea6c1f997603278c3e0196fc39ad0f857515b6`.
GitHub run [36019725512](https://github.com/praksh1/HomeTuition/actions/runs/36019725512)
completed successfully at 2026-09-24 15:27:04 UTC:

- 21 generator/probe tests, no skips.
- Both pinned Docker images pulled; Compose and Caddy validated successfully.
- SHA-256-verified LiveKit v1.13.6 binary; generated non-dev configuration booted, accepted only
  its own key pair, exercised the actual read-only probe and created/deleted a disposable test room.
- Existing real-media two-browser journey: 48 passed, 0 failed.
- Isolated web export built against localhost; full teacher/two-student classroom floor journey:
  78 passed, 0 failed. No cloud provider used by these tests.
- Both production and staging `/api/readyz` returned HTTP 200 with `status: ok` after the branch push.
  Remote `main` still equals baseline `e6a27c9`; no production deploy or provider variable change.

No Docker Engine, Go or usable WSL installation found on this Windows host, so Linux/real-server
checks ran on a disposable GitHub runner. Physical phones, public TLS/UDP/TURN, host reboot, load
and malicious refreshed-token replay are NOT verified by these results.

## Problems and surprises

First CI run `36019306745` passed the kit/container/non-dev SFU and real-media suite, but the final
full-classroom permission suite lacked its required web export in this new standalone workflow.
Added an explicit disposable build pointing at localhost before that test; no app logic changed.

Older CLAUDE/VIDEO documents describe Daily as the deployed provider despite the current accepted
LiveKit Cloud release. Inspected the implementation rather than using those stale deployment claims.
Existing provider accepts arbitrary configured LiveKit hosts; a new provider/rewrite is unnecessary.
Current credentials diagnostic copy is Cloud-centric; the private preview probe is host-neutral.
Self-hosted token revocation is NOT Cloud-equivalent (official token-lifecycle docs): cached/refreshed
grants need explicit adversarial replay tests and media-admission enforcement before real-user release.
This first private/synthetic pilot does not silently weaken or claim equivalence for production.
Added LF normalization/attributes so generating the Linux helper from a Windows checkout is safe.
One broad PowerShell `rg` wildcard path failed; explicit directory/file paths used instead.
One GitHub status read timed out at TLS handshake and a later retry succeeded. `gh run view --log`
returned incomplete cached job output after completion; retrieved the job log directly to verify
the 78-check result. Superseded branch checks were cancelled; the final implementation run is green.

## Fabrications found

No new fabricated UI data. No claim that self-hosting is free, deployed, carrier-tested or inherently
cheaper. A healthy HTTP endpoint is explicitly not proof of working video/TURN.

## Deliberately not changed

Production, current preview provider, Railway variables, DNS, secrets, databases, payment logic,
whiteboard/chat UX, native video SDKs, recordings, make-up policy and quiz backlog.

## Remaining risks / next pickup point

Need owner's available Linux VM/provider, preview subdomains and any hosting budget decision before
activation. An async question was sent and is unanswered at this checkpoint. Preparation and
automated checks are finished. Once a host is chosen,
verify firewall/TLS/TURN from external devices, stage only the staging variables in one deploy, and
rehearse rollback. The queued product work is linked in the runbook and existing backlog, not lost.
Deployment checklist: `.agents/backlog/2026-09-24-livekit-self-host-preview.md`. The owner explicitly
asked to preserve the earlier queue; a small durable memory note was added outside the repository
under the permitted memory extensions folder. No timer/reminder or paid account was created.
