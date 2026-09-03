# Claude reconnection and bounded handoff

- Date: 2026-09-03
- Agent: Codex
- Branch: codex/staging-preview-integration
- Base commit: 9e2813a
- Status: complete (handoff sent; Claude's implementation remains pending)

## Requested

Owner reported signed-in access and the open Claude app, continuing previously authorized
Codex/Claude coordination. Keep usage efficient and production unchanged.

## Changed

- No application, infrastructure, account, or deployment changes.
- Restored the minimized Claude desktop window and read the HomeTuition cloud conversation.
- Prepared the bounded message below and initially paused for the action-time confirmation
  required by the Windows computer-use skill. Owner replied "Yes please"; sent exactly that
  message to the HomeTuition cloud conversation in the Claude desktop app.

## Decisions and assumptions

- The desktop computer-use runtime is now available even though the separate browser runtime
  reports no native apps. The previous native-access limitation is superseded by this observation.
- Claude was idle on an old infrastructure-audit response. After the approved send, the full
  handoff appeared as a submitted user message and the composer exposed Stop (active response).
- Codex continues owning integration/deployment and staging review. Claude should only own the
  email-verification messaging patch and tests, on a separate branch.

## Verification

- Clean worktree and correct HomeTuition origin before writing this log.
- Live preview verifier passed: served HTML and all three initial JS bundles match the saved
  staging build, using hometuition-api-staging-production.up.railway.app.
- Remote tips verified read-only: product bc0aa17, infrastructure 5d0e00f, integration 9e2813a.
- Re-read check-email.tsx, AuthGuard redirect and registration/login routing: absent delivery
  params still default to a sent claim; resend ignores the actual response.
- No test suites rerun: runtime code unchanged. No document/classroom UX test performed this turn.
- Confirmed submission once, without duplicate prompts. Receipt and active processing are verified;
  successful branch creation, implementation, tests and push are not yet verified.

## Problems and surprises

- First desktop state read failed because Claude was minimized; activation and fresh window
  selection resolved it. No stale coordinates or guessed controls used.
- Initial network verifier was blocked by sandbox EACCES; identical read-only check passed with
  approved network access. This was not a preview outage.
- Claude's visible last answer says PR #11 must merge before any preview can run. That is obsolete:
  the manual isolated deployment is live without a main merge, documented in the staging log.
- Desktop message transmission requires an immediate confirmation even with standing supervision
  permission; no message was silently submitted.
- During the confirmed send turn, an accessibility click initially reported missing coordinate
  geometry. Activated/refreshed the window with a screenshot, checked the caret in the empty
  prompt, and verified the inserted text before sending. The API reported document-level focus
  even though the screenshot showed the caret inside the prompt. No other field was edited.

## Fabrications found

No new product finding. Reconfirmed the existing unsupported verification-email-sent claim.

## Deliberately not changed

No main merge, deployments, settings, passwords, storage keys, costs, production data, product
source, Claude model/effort settings, or other project conversations were changed.

## Remaining risks / next pickup point

The following prompt has been sent. Next inspect Claude's response/branch once there is meaningful
progress, review its diff and evidence before integration, and continue the separate synthetic
document/approval/classroom review. No background supervision automation was created in this turn.

### Sent Claude prompt

Codex here, coordinating with the owner's permission. Your visible infrastructure checkpoint is
outdated. Do not repeat setup or merge PR #11: Codex manually deployed the isolated preview without
touching main/production. Product remote remains bc0aa17; infra is 5d0e00f; reviewed integration is
codex/staging-preview-integration at 9e2813a. Fetch before inspecting refs, preserve existing work,
and do not reset destructively if your environment has restarted.

Read CLAUDE.md/MEMORY.md/DESIGN.md from the product base, then read the current staging-isolation
note, staging-setup worklog (final continuation supersedes earlier checkpoints), and preview-smoke-
followups backlog from the integration ref. Preview:
https://hometuition-preview.praksh-dhakal.workers.dev . Separate Railway staging API, NEW Neon project,
private staging R2 and three synthetic fixtures are configured. Mail/payment/Daily keys absent;
echo is NOT real-video verification. The old long branch preview points to production: no test
writes there. Codex owns account configuration, document/classroom checks and deployment.

Your ONLY task: email-verification message truth, on a separate claude/verification-message-truth
branch from bc0aa17. If branch creation/push policy prevents that name, report the restriction;
do not repurpose the product/infra branches. In app/check-email.tsx, unknown delivery currently
defaults to 'We sent'; AuthGuard can redirect without params; configured=true/sent=false is
mislabelled as unconfigured; resend ignores {verified:true,sent:false}. Fix UI messaging and route
state handling without weakening verification/onboarding gates or changing backend auth, schema,
token rules, payment, infra, or video. Confirmed submission is not proof of inbox delivery.

Cover absent params, configured=false, configured=true/sent=false, sent=true, already-verified
resend, failed resend and repeated navigation with focused tests. Use design tokens. Run relevant
named workspace typechecks, app tests and design ratchet; distinguish unit tests from rendered
browser evidence. Keep a chronological worklog including failures and what was not tested.
Commit/push only your branch and return SHA, files, exact test results and remaining risks. No
deploy or main merge. Stop after this slice; do not resume slices 5-7 or re-audit completed infra.
To conserve usage, read targeted files, batch checks, avoid repeated full-repo scans and long
progress narration. Ask Codex for missing context rather than inventing credentials or claims.
