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

At 01:01 America/Chicago, the owner gave action-time confirmation and Codex sent the complete task
through the open Claude app. Claude accepted it and entered a running state. Claude's current
five-hour window was 96% used and due to reset at 01:50; the task tells Claude to push a checkpoint
and resume on the same branch after reset rather than restart.

## Low-polling supervision

Created the thread heartbeat `claude-release-candidate-monitor`. It is anchored at 01:52
America/Chicago and then checks every fifteen minutes. On its first post-reset run, it must resume
Claude on the same branch only if the usage limit stopped the task; otherwise it stays silent. It
watches `origin/claude/production-test-release-candidate` and reports only a new meaningful
checkpoint, completion, test failure, blocker, or required owner action. It is forbidden to merge,
deploy, purchase, modify production, create another branch, or send redundant Claude prompts.
Disable it after final review.

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

## Post-completion independent review

Claude completed the first release-candidate pass at `914c210`. Codex did not accept it as
deployable after tracing the new test enrolment through the existing notification, attendance and
idempotent-booking paths:

1. `sessionMessages.ts::participantIds()` still selected only `payment_status = 'paid'`, so a
   teacher's class-thread message could not reach an active test student's user channel. This is
   the same missing red-dot/buzz direction the owner had already reported.
2. The booking route emitted `test: true`, but `NotificationEvent`, the email formatter and the
   in-app booking formatter did not consume it. The transactional email still said the test
   student had "booked and paid" even though no payment occurred.
3. Any existing `payment_status = 'test'` row returned `{ alreadyBooked: true, paid: true }`, even
   after the test-access switch was disabled and membership correctly refused the classroom. The
   same early return prevented that dormant row being upgraded through the real gateway.
4. `participation.ts` selected paid enrolments only, so the teacher's roster/attendance response
   omitted the active test student during the supposedly end-to-end test.
5. `SessionCard` derived its test label only from the viewing student's enrolment. Teacher-facing
   cards therefore had no durable class-level test marker, despite showing the ordinary price.

After explicit action-time confirmation, Codex sent these findings to Claude with narrow fixes,
targeted regression requirements and the original branch/deployment constraints. Claude accepted
the prompt and resumed work on `claude/production-test-release-candidate`. The monitor was
reactivated after `914c210`; production remains unchanged.

## Next pickup

1. Let the heartbeat report a checkpoint instead of manually polling Claude.
2. Independently review Claude's branch and rerun risk-proportionate tests.
3. Build and deploy a preview release candidate first. Then, only with passing evidence and owner
   approval, fast-forward/merge the reviewed release into `main`, deploy the API in the documented
   additive-schema-first order, enable the two production test kill switches, create only explicit
   short-lived owner test grants, and verify the real Daily classroom on the main domain.
4. Keep payment credentials configured; ordinary users must never gain the test bypass.

## Second independent review after `edd0425`

Claude's follow-up fixed the first five cross-cutting defects and additionally corrected the
`session_live` audience. Its reported gates were green at `edd0425`, but Codex found one remaining
release-blocking truthfulness/model contradiction before any deployment:

1. The implementation reused a single `test`/`testLabel` fact for two different meanings: a class
   being eligible for tightly authorized test bookings, and a particular viewer's enrollment
   actually having bypassed payment. Ordinary students still pay full price for a test-enabled
   class, so showing “TEST — no payment was processed” on every such session or classroom is false.
2. The student Book action still mounted `PaymentSheet` and collected payment method, phone and PIN
   before the server bypassed the gateway for an eligible test student. This contradicted the live
   testing walkthrough's claim that no payment screen appears and needlessly collected credentials.
3. A plain-text transactional email contained literal Markdown emphasis markers around the
   no-payment sentence.

With the owner's action-time confirmation, Codex sent Claude a final correction prompt on the same
`claude/production-test-release-candidate` branch. It requires separate class-level
`testClass`/`testEnabled` truth from viewer-level `testBooking`/`viaTestAccess` truth; a
server-authored `canBookAsTest` eligibility fact using the existing authenticated access endpoint;
direct booking without mounting `PaymentSheet` only when all three server gates are currently
satisfied; independent gate enforcement again at POST; truthful labels for ordinary, paid and test
viewers; removal of Markdown stars; rendered/API regression tests; full gates; updated walkthrough
and worklog; commit and push.

Claude visibly resumed after receiving the prompt. The quiet fifteen-minute heartbeat was
reactivated to watch only for a meaningful checkpoint, completion or actionable blocker. No merge,
deployment, account/configuration change, purchase, credential change or production-data mutation
was authorized or performed.
