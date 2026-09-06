# Staging user-journey audit

- Date: 2026-09-04
- Agent: claude
- Branch: `claude/staging-user-journey-audit`
- Base commit: `bc235ba` (`origin/codex/staging-preview-integration`)
- Status: complete — two defects found and fixed, one open question closed, nothing deployed,
  nothing merged, no PR

## Requested

Walk the whole staging journey against a real server and fix only verified code defects:
registration → verification email → verified login; teacher document upload → operator review;
the unapproved-teacher tier lock; the temporary staging teaching grant; session creation →
student booking → classroom entry; and forgot/reset password security. Preserve production
isolation, payment rules, membership, the WebSockets and `VIDEO_PROVIDER=echo`.

## How it was audited

Not by reading. A Postgres 16 cluster was started locally, `pnpm run db:push` applied to a fresh
database, and the API run **in staging's own shape**: `VIDEO_PROVIDER=echo`,
`ALLOW_TEST_TEACHING_ACCESS=true`, `NODE_ENV=production`, and **no** mail, payment, Daily or R2
credentials. The journey was then walked through the real HTTP API, one step at a time, recording
what each step actually answered.

That shape matters. Most of this project's suites test what happens when a thing works. Staging is
a server with things deliberately switched **off**, and both defects below live in the answers it
gives when something is missing — which is precisely what the owner sees on the preview.

## Defects found and fixed

### 1. A server that cannot send email told people to wait a minute for one

`POST /auth/verification/resend` answered **429 "Please wait a minute before asking for another
email."** on staging, where no mail provider exists and no email had been or could be sent.

Not an edge case — the ordinary path. `sendVerificationEmail` consulted the rate limiter
(`issueToken`) *before* the mail configuration, and registration always issues a verification
token, so **the first resend anybody can press is always inside the one-minute cooldown.** Every
tester pressing Resend on the preview got a sentence about an email that did not exist.

It also quietly defeated the fix in `2026-09-03-claude-verification-message-truth.md`. That work
stopped `check-email.tsx` claiming an email it could not confirm; the screen then faithfully
rendered *this* sentence instead, because it is what the server said.

**Fix** (`lib/accountSecurity.ts`, `routes/auth.ts`): `isEmailConfigured()` is read before the
cooldown, and a server that cannot send says so whatever the cooldown thinks — 503 *"Email
delivery is not configured yet."* The response also now carries `emailConfigured`, the way
`/auth/password/forgot` already did, so the screen never has to infer configuration from an error
string. Token issuing and rotation are untouched; when a provider *is* configured, the 429 still
happens exactly as before.

**Measured:** 429 with "wait a minute" → 503 with `{"sent":false,"emailConfigured":false}` and
"not configured".

### 2. A paid student who was simply early was told they were not enrolled

A student who had booked and paid, opening their class the evening before, got
**403 "You must be enrolled in this session to join it."** That sentence is not unhelpful, it is
**false**: they were enrolled, they had paid, and only the clock was wrong.

`canAccessSession` collapsed four different situations into one `false` — never enrolled, not
paid, class cancelled, and outside the join window — and the room route turned all four into the
first one's wording. This project has fixed the same wound in the other direction, when a dropped
student's screen went on saying "Booked & paid".

**Fix** (`lib/membership.ts`, `routes/sessions.ts`): a new `accessRefusalFor()` returns *which*
refusal it is, and `canAccessSession` is now defined in terms of it — so **who gets in has not
changed by one row**, and the whiteboard socket and the room route still cannot drift apart, which
is the whole reason that file exists. Only the wording differs: outside the window is now a 409
carrying `canJoin`'s existing sentence ("This class opens 10 minutes before it starts — that is in
1 day.") and `expired: true`, the same shape the route's later timing check already returned, so
the classroom displays it with no client change at all.

**Measured:** 403 "must be enrolled" → 409 "This class opens 10 minutes before it starts — that is
in 1 day."

## An open question from the previous worklog, closed

`2026-09-03-codex-staging-setup.md` recorded: *"Clicked approval with no documents; no successful
approval was observed. Browser tooling did not expose the notification dialog, so this is NOT
claimed as a fully verified UI refusal."*

It is verified now, at the API: `POST /admin/teachers/:userId/decision` with `approved` for a
teacher who has submitted nothing returns **409 "Open and approve the teacher's submitted identity
documents before approving the account."** It is asserted in the new suite so it stays true.

## What was walked, and what it did

| Step | Result |
|---|---|
| Register teacher / student, no mailer | 201, and honest: `verificationEmailSent:false`, `emailConfigured:false` |
| Same address twice | 409 |
| Wrong password vs unknown account | identical 401 and identical body — no enumeration |
| Resend verification | **was wrong, now 503 and truthful** |
| Verified sign-in | 200, `emailVerified:true` |
| Ask to upload with R2 off | 503 "File uploads are not set up on this server yet." |
| Credential naming a file never uploaded | 400 "That file does not belong to you." |
| Pending teacher: plan eligibility | `allowed:false`, `code:"OPERATOR_REVIEW"` |
| Pending teacher: buy a tier | 403 with the same code |
| Pending teacher: create a class | 403 with the same code |
| Operator approves with no documents | 409 — refused |
| Document decision `"accepted"` | 400 "Choose approved or rejected." |
| Document rejected with no reason | 400 — a teacher must be told what to fix |
| Document approved, then account approved | 200, and both say the teacher was **not** notified because email is off |
| Test grant to a non-teacher | 404 |
| Test grant with no written reason | 400 — an unexplained grant cannot be audited |
| Test grant, explained | 201 with `validUntil` and `grantedBy` |
| Eligibility after grant | `allowed:true` |
| Create class → book → pay | 201, `paymentStatus:"paid"` in one step, no pending state |
| Teacher room | `provider:"echo"`, `isOwner:true` |
| Paid student room | 200, `isOwner:false` |
| Non-booker room | 403 "must be enrolled" — correct here |
| Paid student, a day early | **was wrong, now 409 with the doors-open time** |
| Student reads `/admin/users` | 403 |
| Teacher grants themselves test access | 403 |
| Forgot password, known vs unknown | identical, plus `emailConfigured:false` |

## Not a defect, but the owner will hit it

**A teacher cannot buy the monthly plan on staging, and should not be able to.**
`chargeForMonthly` refuses a `teacher-plan` purchase whenever payments are simulated and
`NODE_ENV !== "test"`, with *"Online plan payment is not connected yet. No plan was activated and
no money was taken."* That is deliberate and right — a simulated payment must not grant the right
to sell classes — but it means the monthly journey stops at the paywall on the preview. The
ordinary per-class booking is simulated and does complete.

It also cost time here: four suites (`monthly`, `one-chat`, `late-joiner`, `teacher-leave`) create
a monthly class and so fail against any server not running `NODE_ENV=test`. They were briefly
suspected of being broken; they are not, and all four pass when the server is started the way they
expect. Recorded so the next person does not re-diagnose it.

## Changed

| File | Change |
|---|---|
| `artifacts/api-server/src/lib/accountSecurity.ts` | mail configuration is read before the cooldown; `sendVerificationEmail` returns `configured` |
| `artifacts/api-server/src/routes/auth.ts` | the resend response carries `emailConfigured` |
| `artifacts/api-server/src/lib/membership.ts` | `accessRefusalFor()` added; `canAccessSession` defined in terms of it |
| `artifacts/api-server/src/routes/sessions.ts` | the room route answers with the true refusal; outside-the-window is a 409 with the timing sentence |
| `artifacts/api-server/scripts/journey-audit/run.mjs` | **new.** The whole journey as 49 assertions, starting its own staging-shaped server |
| `artifacts/api-server/package.json` | `test:journey` |

Nothing in `artifacts/sikshya`, `lib/`, `src/ws/`, `lib/payments.ts` or the schema was touched —
verified by `git status` against those paths. No dependency was added.

## Verification

Both fixes were proved to be real regressions rather than descriptions: with the four source files
stashed and the server rebuilt, the new suite fails **7 of 49** with exactly the old wrong answers
(`429 "Please wait a minute…"`, `403 "You must be enrolled…"`); with them restored it is 49/49.

| Command | Result |
|---|---|
| `pnpm run typecheck` | **pass**, all four packages |
| `pnpm --filter @workspace/api-server run test` | **280 pass, 0 fail** |
| `pnpm --filter @workspace/sikshya run test` | **170 pass, 0 fail** |
| `pnpm --filter @workspace/sikshya run lint:design` | **no new leaks**; 205 hex / 418 sizes, unchanged |
| `git diff --check` | clean |
| `test:journey` *(new)* | **49 passed, 0 failed** |
| `test:video` | **16 passed, 0 failed** — echo and Daily contract unchanged |
| `test:sessions` | **56 passed, 0 failed** |
| `test:reset` | **25 passed, 0 failed** — expiry, one-time use, re-issue, current-password refusal, concurrency, no token in logs |
| `test:test-access` | **26 passed, 0 failed** |
| `test:admin` | **58 passed, 0 failed** |
| `test:operators` | **50 passed, 0 failed** |
| `test:tiers` | **31 passed, 0 failed** |
| `test:attendance` | **72 passed, 0 failed** |
| `test:class-chat` | **36 passed, 0 failed** |
| `test:monthly` | **199 passed, 0 failed** |
| `test:one-chat` | **8 passed, 0 failed** |
| `test:late-joiner` | **13 passed, 0 failed** |
| `test:teacher-leave` | **17 passed, 0 failed** |

`membership.ts` is shared with the classroom WebSocket, so proving the socket unchanged was the
point of running `attendance`, `class-chat`, `one-chat`, `late-joiner` and `teacher-leave` as well
as the HTTP suites. All pass.

## Fabrications found

**None found** in the paths walked. The opposite, in fact, and worth recording because this
project's log is mostly the other way: every refusal on the journey named its real reason, and
both operator decisions volunteered that the teacher had **not** been notified rather than
implying they had. The two defects above were untrue *messages*, not invented data — no fabricated
number, no invented record. No row added to `.agents/backlog/ui-upgrade-progress.md`.

## Deliberately not changed

- **The staging deployment.** Nothing was deployed, redeployed, merged, or pushed anywhere but
  this branch. No PR.
- **`VIDEO_PROVIDER=echo`**, production isolation, the Neon staging project, Railway variables,
  and the Cloudflare preview — all untouched.
- **Payment rules.** The monthly-plan refusal above is correct and was left alone.
- **Booking atomicity, membership, the WebSockets** — the access decision is byte-for-byte the
  same set of people; only the wording of a refusal changed.
- **The app.** Both fixes are server-side, and the classroom already renders a 409's message
  verbatim, so no client change was needed. `noticeFromResend` was left alone rather than given
  speculative handling for a field it does not currently reach.
- The four monthly suites' `NODE_ENV` requirement — documented above rather than worked around.

## Remaining risks / next pickup point

1. **The verification link itself has never been clicked.** With no mail provider the token is
   only in `account_tokens`, hashed, so this audit marked addresses verified in the database and
   said so. `/auth/verification/confirm` is unit-covered but the end-to-end click needs a mail
   provider — the same boundary the previous worklogs record.
2. **Document upload is still unproven.** R2 is off in this environment, so the credential row was
   inserted directly and only the *review* was exercised. The upload half needs the staging bucket
   the previous worklog was midway through arranging.
3. **Owner action:** both fixes are server-side, so seeing them on the preview needs a staging
   redeploy of this branch. Nothing was deployed here.
4. The monthly journey on staging stops at the plan paywall by design; testing it end to end needs
   a payment provider, which is a launch decision, not a bug.
