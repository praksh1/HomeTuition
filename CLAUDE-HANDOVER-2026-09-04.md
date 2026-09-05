# Sikshya handover to Claude — 4 September 2026

This is the authoritative pickup document for the current Codex → Claude transition. It records
what is actually deployed, what each agent did, what failed, what was deliberately left alone, and
the next safe work. Do not reconstruct state from chat excerpts or an old branch preview.

## Read first

1. `CLAUDE.md`
2. `.agents/memory/MEMORY.md`
3. `HANDOVER.md`
4. `DESIGN.md`
5. this document
6. `.agents/memory/production-test-release-live.md`
7. `.agents/worklog/2026-09-04-codex-production-test-release.md`
8. `.agents/worklog/2026-09-04-claude-production-test-release-candidate.md`
9. `.agents/backlog/2026-09-02-owner-corrections-and-stream-poc.md`

Run `git fetch --all --prune` before comparing refs. Preserve any live Claude worktree; never use a
destructive reset over uncommitted work.

## Exact source and deployment state

- Production source: `origin/main` at **`999fe3b`**.
- The same reviewed tree remains at `origin/claude/production-test-release-candidate`.
- Production web: `https://hometuition.praksh-dhakal.workers.dev/`
- Production API: `https://workspaceapi-server-production-5a63.up.railway.app`
- Deployment workflow: GitHub Actions run **`33889966505`**, successful.
- Production Worker bundle observed after deployment:
  `_expo/static/js/web/entry-da308df1a79efb1e2a688f67e07be405.js`.
- Production API `/api/healthz`: HTTP 200 after release.
- Codex's post-release documentation branch: `origin/codex/production-release-log` (production
  audit checkpoint **`e023bc2`**, with this handover committed after it). This branch is based on
  production but its last commits are documentation only; it was intentionally not merged to
  `main` because a docs-only main push would redeploy everything.
- Stream Video POC: `origin/claude/stream-video-poc` at **`8550631`**, isolated, not merged, not
  deployed, and not ready for real media.
- **Daily remains the live provider.** Do not merge Stream into the classroom while continuing the
  current production verification.

## What Codex asked Claude to do, and the result

Claude was deliberately given the large, bounded implementation work; Codex reviewed, integrated,
deployed, configured and verified it.

### Owner correction packet, items 1–6

Claude reconciled and completed the packet on `claude/production-test-release-candidate` rather
than rebuilding already-correct work:

1. Professional operator decision language and truthful email/in-app delivery reporting.
2. Server-backed disabled teaching tiers before email verification/operator approval.
3. Thirty-minute, one-time password-reset links; new issue invalidates old unused links; current
   password cannot be reused; honest forgot-password confirmation/resend UX; independent show/hide
   controls.
4. Audited, expiring, operator-granted teacher test teaching access behind a default-off server
   switch.
5. Automatic freehand-to-shape conversion removed from the active whiteboard while explicit
   Excalidraw tools and the dormant recognition research module remain.
6. One shared call-window state machine for teacher and student. Minus now means compact and snaps
   to bottom-right; Restore returns to normal; Hide/Show remains available; header/body clipping was
   fixed so painted call content does not swallow controls.

Claude also fixed two independent release blockers: early classroom entry is no longer described
as an expired session, and an unconfigured email provider no longer mints/burns a verification
token or cooldown. A pre-existing wrong-role early return that caused React hook-order error 310 on
cold classroom opens was moved below all hooks.

### Controlled production test booking

Claude built the three-gate model that lets the owner test real Daily without making the public site
free:

1. `ALLOW_TEST_TEACHING_ACCESS` is on and the teacher has a live operator grant.
2. A class is immutably recorded in `test_classes` when created under that live teacher grant.
3. `ALLOW_TEST_STUDENT_ACCESS` is on and the booking student has a live operator grant.

Only the intersection bypasses payment. The enrolment status is `test`, no payment reference is
invented, and money/refund/earnings queries remain paid-only. The server re-derives eligibility
inside the booking transaction. The eligible student sees a direct “Take a test place — no
payment” action and does not enter a method, phone number or PIN. An ordinary student still pays
for the same test-enabled class. A granted student still pays for an ordinary class.

Claude's first cut was independently reviewed and corrected across all result surfaces: thread
audience, roster, attendance, start notifications, booking response, email/push/in-app wording,
teacher cards and classroom labels. The final model intentionally separates:

- `testClass` / `testClassLabel`: fact about the teacher's class; never says a viewer paid nothing.
- `testBooking` / `testBookingLabel`: fact about one student's place; may say no payment happened.

Read `.agents/worklog/2026-09-04-claude-production-test-release-candidate.md` for the exact files,
commits and test counts. Do not collapse those two facts back into one flag.

### Stream Video alternative

Claude built and audited disabled scaffolding only on `claude/stream-video-poc` at `8550631`.
Reaction expiry and duplicate `onLeft` firing were fixed; token TTL and observable wiring have
tests. It is **not ready for real media**: no Stream account/credentials, no installed SDKs, no
real room/device/screen-share test, native WebRTC class/module collisions with Daily, no measured
Kathmandu latency/reconnect behavior, and call-type grants/API shape remain unverified. Do not merge
it as part of the current release. Revisit only as a separately approved provider experiment.

## What Codex did after Claude's candidate

1. Reviewed the release candidate and its evidence rather than rebuilding it.
2. Fast-forwarded `main` from `2663ac2` to `999fe3b` and pushed it.
3. Watched GitHub Actions and Railway deployment to successful completion.
4. Verified the normal production Worker serves the new bundle and the production API is healthy.
5. Created the additive production Neon tables required by the release. No existing table/column
   was dropped or altered.
6. Enabled only these exact Railway production switches:
   - `ALLOW_TEST_TEACHING_ACCESS=true`
   - `ALLOW_TEST_STUDENT_ACCESS=true`
7. Used the live operator desk to grant the owner-selected teacher and student seven days of
   narrowly scoped test access.
8. Wrote and pushed the durable production release/account audit to
   `codex/production-release-log`.

No purchase, payment key, payment mode, plan price, Daily configuration, DNS, or real payment record
was changed. No simulated global production mode was enabled. No grant was inserted by SQL.

## Production database incident — do not lose this correction

Before deployment, `test_student_grants` and `test_classes` were created and verified in production
Neon. The first release note incorrectly stated that `test_teaching_grants` already existed.

After deployment, opening teacher user 719 in the production operator desk failed with “This record
could not be loaded.” Railway logs gave the exact cause:

`relation "test_teaching_grants" does not exist`

Codex created `public.test_teaching_grants` and its `(teacher_id, valid_until)` index in one
transaction. Reloading the same operator record succeeded, and the teacher grant then succeeded
through the audited API. The application/schema code already described this additive table; the
production database had simply never received it. Never repeat the claim that it pre-existed.

## Active production test accounts

The owner explicitly chose:

| Role | Account | User | Access | Expires |
|---|---|---:|---|---|
| Teacher | `praksh.temp@gmail.com` | 719 | base test-teaching allowance | 11 Sep 2026, 1:30 PM Central |
| Student | `student@sikshya.np` | 706 | test booking access | 11 Sep 2026, 1:38 PM Central |

Both operator grants use the audit reason:

`Owner-authorized production classroom and whiteboard verification`

Both were verified visible as active on their live production person records. The teacher is
email-verified, operator-approved and has an approved citizenship-document review. The grant still
obeys the base allowance; it is not unlimited.

The first student grant was correctly refused because this old repository-seeded demo account had
no `user_onboarding` row. A read-only Neon query confirmed the row was absent. The known seed account
then signed in through `/auth/login` and completed `/onboarding/me` through the supported application
API with explicitly synthetic test data: adult test DOB, placeholder test phone,
Bagmati/Kathmandu/Kathmandu, and institution/locality labels identifying a Sikshya production test
account. The operator grant was retried and succeeded. No password was changed and no eligibility
check was bypassed. If this demo identity is ever repurposed as a real person's account, replace
those placeholder onboarding facts through the profile/onboarding product flow.

## Exact owner test journey on the normal website

Use `https://hometuition.praksh-dhakal.workers.dev/welcome`, not localhost and not the old preview.

1. Sign in as `praksh.temp@gmail.com`.
2. Create a **new** class while the teacher grant is active. Old classes do not become test-enabled
   retroactively.
3. On another device/browser, sign in as `student@sikshya.np`.
4. Open that newly created class. The eligible action should say “Take a test place — no payment”
   and must not open the payment sheet or request phone/PIN.
5. Join near the scheduled start from teacher laptop and student iPhone/Android. This uses the real
   Daily integration, unlike the old echo staging preview.
6. Verify: Excalidraw tools and freehand ink, teacher-to-student board sync, Daily remote video and
   screen share, compact/minus/Restore/Hide/Show, drag/resize bounds, chat sheet, unread chat signal,
   attachments, waiting/early banner placement, and leave/session completion.

Browser automation and echo tests are not evidence that the real two-device Daily call behaves on
iOS/Android. The owner's hardware walkthrough is the remaining release evidence.

## Known operational mistakes and recoveries

- The first Railway variable was mistyped as `ALLOW_TEST_TEACHER_ACCESS`. Source review caught it;
  it was deleted and replaced with `ALLOW_TEST_TEACHING_ACCESS` before the final active deploy.
- The first health probe used `/health` and returned 404. The real endpoint is `/api/healthz`; it
  returned 200. There was no outage.
- Root `pnpm run typecheck` can say success while Windows workspace filters match nothing. Run each
  named package TypeScript check and record it; do not cite the empty root run alone.
- Windows sandboxing can block pnpm junction traversal and falsely report installed packages such
  as `jose` missing. The identical checks passed with dependency read access. Do not edit the
  lockfile to “fix” that environmental error.
- Running rendered board and performance suites concurrently overloaded the machine and produced a
  false performance failure. Run the performance suite alone.
- The initial student operator grant was not a UI failure; its alert precisely reported incomplete
  onboarding. The requirement was satisfied through the supported account route, then the same
  operator action passed.
- A docs-only commit was kept off `main` to avoid an unnecessary production redeployment.

## What is deliberately not done

- No real two-device Daily classroom has been claimed as verified after this deployment.
- No real payment has been made, simulated receipt invented, or payment gateway disabled.
- No Apple/Google/Facebook button is visible; the saved integration code remains dormant for later.
- No Stream provider merge, account purchase, SDK install or production toggle.
- No automatic shape recognizer deletion; only activation was removed, preserving research code.
- No global free-test flag, hard-coded test email, production `NODE_ENV=test`, or blanket plan
  unlock.
- No production database column/table drop.

## Claude's current work and leader instructions

The owner has pasted the most recent Codex prompt into Claude and reports Claude is currently
working. Do not start a second overlapping implementation. When that turn completes:

1. Report the exact branch, base SHA, final SHA and whether the worktree is clean.
2. Compare the diff against `origin/main@999fe3b` and this handover; do not assume an old preview or
   old branch is production.
3. Identify which requested behavior is genuinely new versus already live. Reconcile; do not
   rebuild or silently revert the production-test model.
4. Prove every changed business/security rule at the API boundary and every changed classroom/UI
   control in a rendered test where available.
5. Run named package typechecks, relevant unit/contract/rendered suites, `lint:design`, and
   `git diff --check`. Never run `lint:design:update` merely to bless new leaks.
6. Keep Daily active and the Stream POC isolated. Do not touch purchases, secrets, Railway,
   Cloudflare, Neon or `main` without a separately stated deployment task.
7. Write a chronological `.agents/worklog/` entry covering requested scope, exact changes, tests,
   failed attempts, fabricated-data audit, deliberate omissions, risks and pickup point. Update
   memory only for durable lessons.
8. Commit and push only the bounded Claude branch, then stop for review. Do not self-merge merely
   because tests pass.

## Next priorities

1. **Owner hardware test now:** the grants expire 11 September. Fix only defects actually observed
   in the real Daily/whiteboard journey.
2. **Review Claude's current branch:** compare it to `999fe3b`; reject duplication, broadened scope,
   stale assumptions and any payment/provider change.
3. **After fixes pass:** prepare one reviewed fast-forward candidate and provide the owner the normal
   production URL. Deployment must still be explicit and observable.
4. **Before public launch:** turn both Railway test-access switches off. Leave grant/enrolment rows
   as audit history; do not delete them. Confirm ordinary students cannot see the test-place action.
5. **Later, separately:** real Stream/alternative-video feasibility work with a provider account,
   real SDKs and real devices. `8550631` is scaffolding evidence, not a production replacement.

## Non-negotiable product rules

- Whiteboard is the product; cheap Android on weak Nepal networks is the target.
- No raw hex or font-size regressions. Royal blue is action; crimson is brand/live only; burnt rust
  is destructive; use the scrim token.
- Preserve booking atomicity, membership's single source of truth, WebSocket behavior and Daily
  while working on UI.
- Never show fabricated money, counts, ratings, availability or delivery claims.
- Pay-per-class and monthly are different products; prices carry units in words.
- Daily's internal chat remains disabled; Sikshya's single class chat is authoritative.
- Schema deployment order matters. Additive new tables are safer; a new column read by a broad
  select can take the API down until the database is updated.
- The owner is non-technical: run terminal/Git/deploy commands yourself, give clickable HTTP links,
  and say plainly what is and is not proven.
