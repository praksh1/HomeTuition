# Production legacy-file and message-readiness safety review

- Date: 2026-09-30
- Agent: Codex production-promotion subagent
- Branch: codex/production-journey-fixes-sep30
- Base commit: f9b0506f3d424e4aeaf0f86366eab4bfa8722432
- Status: complete

## Requested

Narrow safety review of the local Production candidate: keep legacy operator citizenship previews working while ordinary avatars/messages cannot reuse those documents, and verify additive message-safety initialization. Root owns final build and release; no commit, push or deployment authorized for this subtask.

## Changed

- `artifacts/api-server/src/lib/legacyIdentityFiles.ts`: exact-key review authorization checks current database operator role and suspension rather than trusting a previously issued token. Follow-up also checks live operator-account disablement and mandatory first-password change; explicit strict enforcement refuses legacy admins lacking an operator account.
- `artifacts/api-server/src/lib/fileStore.ts`: separate 120-second operator review signer; ordinary links remain identity-blocked. Cached avatar hits recheck citizenship classification and fail closed if database checks fail.
- `artifacts/api-server/src/routes/storage.ts`: legacy ID preview uses the dedicated reviewer path before ordinary attachment ACLs; private/no-store response, no-referrer, and 503 on classification/review failures with no permissive fallback.
- `legacyIdentityPrivacy.test.ts`: executable real signer/route isolation, with synthetic DB/AWS boundaries only.
- `messageSafetyInitialization.test.ts`: executable actual additive initializer, concurrent single-flight and recovery after failure at each DDL phase. No message-safety runtime or schema changes in this subtask.

## Decisions and assumptions

Historical withdrawn/rejected citizenship keys remain private but available to an active operator for review. No documents are deleted or migrated. Ordinary files retain ten-minute link compatibility. A signed URL already issued is a bearer link until expiry; cached URLs are no longer reissued after a file becomes ID evidence. The Cloudflare skill and current presigned-URL documentation informed the dedicated short-lived reviewer path; no Cloudflare configuration changed.

## Verification

- Focused suites: 15 tests passed, including disabled/unrotated operator refusal, strict enforcement, ordinary participant-file compatibility, and deliberate in-memory guard removal proving the privacy assertion goes red.
- API typecheck: passed.
- Complete API unit suite: 778 tests passed, no failures/skips.
- `git diff --check`: passed. Git warned only about the repository's LF-to-CRLF handling.
- Parent independently checked Production schema read-only: CREATE privilege and users/messages/message_reactions/disputes dependencies exist; three new message-safety tables are absent as expected before deployment. This subagent made no live schema writes.

## Problems and surprises

The ordinary signView identity guard prevented the existing operator UI from previewing historical citizenship uploads. A previously ordinary avatar cache hit also bypassed a later citizenship classification; both are now covered by actual runtime tests. Root flagged that disabled/first-password operator rows retain the admin user role: review authorization now checks those records too, independently of JWT role. The f9 Production `requireAdmin` middleware does not contain these restrictions; its admin router applies them separately. One initial PowerShell Get-Content invocation incorrectly passed multiple positional paths; corrected with a comma-separated LiteralPath list, no source or data affected.

## Fabrications found

None found in this narrow safety scope. Test credentials, accounts, URLs and failures are explicitly synthetic.

## Deliberately not changed

Owner Cost & Health dashboard, frontend layout, payment/make-up logic, identity feature flags, student-ID policy, external services and deployed versions. No real accounts, documents, payment or provider credentials used.

## Remaining risks / next pickup point

Root must freeze/stage the candidate, rebuild final artifacts, run live release gates, deploy and verify additive safety tables actually initialize. This subtask does not claim a live operator-document or live database integration test. Operator-only legacy preview links remain bearer URLs for their two-minute lifetime.
