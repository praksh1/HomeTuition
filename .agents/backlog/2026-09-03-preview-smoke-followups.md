# Preview smoke follow-ups and bounded Claude assignment

Read CLAUDE.md, MEMORY.md, the staging-isolation note and the current staging worklog first.
Do not repeat infrastructure setup, replace production credentials, or claim current access from
old chat history. Cloudflare sign-in was completed by the owner and staging storage now works.
Claude's desktop app is now reachable. Owner confirmed sending the bounded assignment below;
Codex sent it and verified receipt/active processing on 3 September. Implementation and push are
pending. See `.agents/worklog/2026-09-03-codex-claude-reconnection.md` for the exact sent prompt.

## Active bounded Claude assignment

Claude completed this first assignment on `claude/verification-message-truth` at `6eca5ba`.
Codex reviewed and cherry-picked it into staging integration as `ee446c7`; 168 app tests, 280 API
tests, named workspace typechecks and the design ratchet passed locally. A staging build pinned to
the isolated API also completed. Live preview deployment/resend-flow review is recorded separately
in the staging setup worklog; do not reimplement this slice or confuse unit-tested resend outcomes
with a live authenticated check.

Base a separate `claude/verification-message-truth` branch on reviewed product `bc0aa17` (or
coordinate a newer base with Codex). Own ONLY email-verification status messaging and tests.
Do not change auth rules, DB schema, token lifetime, payments, infrastructure, or deploy anything.

Reproduction on the isolated preview: register teacher with email service deliberately absent.
API returns verificationEmailSent=false/emailConfigured=false, but the app ends at `/check-email`
with no params and says "We sent a verification link." Trace AuthGuard in app/_layout.tsx,
registration routing and app/check-email.tsx. Unknown delivery must not default to sent. Distinguish
unconfigured delivery, send failure and confirmed submission without revealing more account data.
Also handle `/auth/verification/resend` returning `{verified:true,sent:false}` correctly: never
claim that response sent another email. Preserve design tokens, backend enforcement and onboarding.

Acceptance: tests for absent params, sent=false, configured=false, sent=true, already-verified
resend, failed resend and repeated navigation. Check real browser where available; never mistake
unit tests for a rendered flow. Run named workspace typechecks, app tests and design ratchet.
Commit/push only your branch; send SHA, changed files, commands/results and precise remaining gaps
to Codex for review. Keep a detailed chronological worklog including failed approaches.

## Other findings / remaining review

- Slice 5 (automatic shape conversion) was completed by Codex on clean branch
  `codex/shape-recognition-disabled` at `51b57f5`, then integrated as `a918f51`. The contaminated
  `claude/slice5-shape-recognition-wip` at `c908d7f` was not merged. App tests, named typechecks,
  design lint, staging build, **44/44** real-browser board checks, and the standalone 6×-slowdown
  performance run passed. Staging deployment and owner classroom verification are the remaining
  gates; do not reimplement this slice.
- Codex attempted to send Claude this clean Slice 5 assignment only after the owner's explicit
  confirmation. At action time the computer-control bridge exposed browser tabs but no native apps,
  although Claude processes were running, and no Claude CLI executable was available on `PATH`.
  Codex did not pretend the message was sent and used a read-only parallel audit instead. A future
  Claude prompt should review the committed/integrated result or take a new disjoint slice, not
  duplicate the completed recognition work.

- Reconfirmed existing welcome sample counts and login demo-account hint. Already queued in
  ui-upgrade-progress.md; do not invent smaller numbers or real-looking fixture statistics.
- Staging currently has synthetic teacher/student/operator, with test-only completed onboarding
  rows. Real onboarding/photo/document upload is NOT proven by this fixture setup.
- Tier and payment locking for pending teacher are verified in browser. Support/People and the
  test-access approval gate rendered. No teacher approval or grant has been manufactured.
- Isolated R2 bucket and bucket-restricted credentials are now configured. The authenticated
  storage write/read/delete diagnostic passed. Proceed to synthetic document flow tests; do not
  repeat storage setup or treat the diagnostic as proof of document-review UX.
- Test real synthetic-file selection, upload, operator opening/locking, reject/reupload,
  accept-document wording vs teacher-account approval, and truthful unavailable-email notice.
- Then grant a short-lived test entitlement through the actual operator action and create a
  synthetic class. Verify teacher/student board/chat with echo; label real Daily/video testing
  as still untested. Never bypass membership or atomic booking.
- Public reset-link expiry/reuse remains unverified, including the owner's original 2-day-old
  link report. Do not mark that report explained by the current unit-test result.

Codex owns integration/deployment and account configuration; Claude owns the bounded messaging
patch once reachable. No main merge or production publish until owner review.
