# Production-test release reconciliation

- Date: 2026-09-04
- Agent: Codex, coordinating Claude
- Working branch: `codex/staging-preview-integration`
- Status: in progress; no product commit merged, no deployment made

## Owner request

The owner cannot meaningfully test recent work because the isolated preview uses the `echo` video
provider and the public production site has a configured payment gateway. They asked to restore a
real three-device Daily test path on the main public site, bring Claude back into the same project
state, give Claude long non-overlapping tasks, monitor it without repeated polling, finish the
remaining correction list, and preserve a complete cross-agent record.

## Reconciled branch state

- `origin/main`: `2663ac2`. This is the current Git production line and is the common ancestor of
  every active correction branch.
- Product corrections: `origin/claude/excalidraw-whiteboard-sync-gjoqaz` at `bc0aa17`.
- Staging integration: `origin/codex/staging-preview-integration` at `bc235ba`.
- Claude staging journey audit: `origin/claude/staging-user-journey-audit` at `b29bb07`.
- Stream experiment: `origin/claude/stream-video-poc` at `8550631`; remains isolated and must not
  be merged into this release.
- Created `origin/claude/production-test-release-candidate` at `b29bb07` as the only branch Claude
  may use for the next task. Creating the branch did not merge or deploy anything.

## Correction-list status before the release task

1. Professional operator decisions and truthful delivery: implemented on the product branch.
2. Tier selection locked before email/operator approval: implemented on the product branch.
3. Password-reset expiry, one-time use, replacement-token invalidation, different-password rule,
   resend state, and show/hide controls: implemented and covered by the product-branch suites.
4. Audited, expiring teacher test access: implemented, but production still needs an explicit
   environment enablement and an operator-created grant before it can help the owner.
5. Automatic freehand-to-shape conversion: removed on the staging integration and manually
   confirmed by the owner in the preview.
6. Honest Daily call-window controls: incomplete. The current minus button toggles small/medium;
   it does not snap Normal/Full to a visibly compact bottom-right state as requested.

## Independent review of Claude's `b29bb07`

Claude's API audit found two real message defects, but the commit is **not integration-safe yet**:

1. It returns HTTP 409 with `expired: true` for every outside-window refusal, including a person
   who is merely early. Both classroom clients currently treat any 409 as terminal expiry. The
   student sets `roomExpired`; the teacher shows “Session already expired” and a Create New
   Session action. The API-only journey suite therefore missed a client regression. The response
   contract and both rendered clients need distinct early/nonterminal versus elapsed/terminal
   handling, plus automatic retry when the door opens.
2. `sendVerificationEmail` reads mail configuration before `issueToken`, but does not return early
   when mail is unconfigured. It can still mint a token and consume the cooldown even though no
   email can be sent. If mail is enabled immediately afterward, the first real resend may receive
   429. It must short-circuit before token issuance and have a transition test.

No part of `b29bb07` was cherry-picked or deployed after these findings.

## Safe live-test design sent to Claude

The owner asked to put payment on hold. Disabling production payment credentials globally was
rejected as unsafe because the public site would then let any visitor create an enrollment without
paying. The release task instead specifies:

- existing operator-granted teacher test access;
- a companion operator-granted, expiring student test access behind its own default-off kill
  switch;
- a durable separate-table marker for sessions created under teacher test access;
- explicit `payment_status = test` / `payment_method = test_access`, never `paid` and never a fake
  gateway reference;
- only an authorized test student may book an explicitly marked test class without contacting the
  gateway;
- test activity is excluded from earnings, paid sales, and refund debt;
- ordinary paid classes and users remain unchanged.

Claude's full task also requires the remaining compact-call fix, a rendered early-door regression
test, reconciliation of correction items 1–6, full authorization/concurrency/revenue tests, and a
deployment/rollback handoff. It forbids deployments, external accounts, credentials, billing,
Daily changes, Stream integration, main changes, and PR creation.

The prompt is drafted in the open Claude app but not sent yet because Windows automation requires
action-time confirmation before transmitting a message. Claude's current five-hour window was 96%
used and due to reset in about one hour; the task tells Claude to push a checkpoint and resume on
the same branch after reset rather than restart.

## Low-polling supervision

Created the thread heartbeat `claude-release-candidate-monitor`, every fifteen minutes. It watches
`origin/claude/production-test-release-candidate`, stays silent while unchanged, and reports only a
new meaningful checkpoint, completion, test failure, blocker, or required owner action. It is
forbidden to merge, deploy, purchase, modify production, or send redundant Claude prompts. Disable
it after final review.

## Live evidence gathered

- `https://hometuition.praksh-dhakal.workers.dev/`: HTTP 200, 1,605-byte HTML.
- `https://hometuition-preview.praksh-dhakal.workers.dev/`: HTTP 200, 1,605-byte HTML.
- Production entry bundle: `entry-4258192bef8986ccdaaeaf9173a1e3f7.js`.
- Preview entry bundle: `entry-d429ffc5931526106997b8692141df71.js`.
- The HTML and all three bundle names differ, confirming the main site does not contain the newer
  preview build.
- The production bundle points to
  `https://workspaceapi-server-production-5a63.up.railway.app`; its `/api/healthz` returned HTTP 200
  with `{"status":"ok"}`.

These checks prove reachability and different deployed assets. They do not prove which source
commit Railway or Cloudflare used, a real Daily call, a payment, or device behavior.

## Deliberately not done

- No production/staging deployment, merge, cherry-pick, PR, database write, environment edit,
  payment-secret removal, test grant, account change, or real booking.
- No claim that echo reproduces Daily media or that the current call window is finished.
- No Stream merge; its fake-tested scaffolding remains research only.

## Next pickup

1. After the owner's action-time confirmation, press Send on the already-drafted Claude task.
2. Let the heartbeat report a checkpoint instead of manually polling Claude.
3. Independently review Claude's branch and rerun risk-proportionate tests.
4. Build and deploy a preview release candidate first. Then, only with passing evidence and owner
   approval, fast-forward/merge the reviewed release into `main`, deploy the API in the documented
   additive-schema-first order, enable the two production test kill switches, create only explicit
   short-lived owner test grants, and verify the real Daily classroom on the main domain.
5. Keep payment credentials configured; ordinary users must never gain the test bypass.
