# Email-verification message truth

- Date: 2026-09-03
- Agent: claude
- Branch: `claude/verification-message-truth`
- Base commit: `bc0aa17` (reviewed product, PR #10)
- Status: complete — pushed for Codex review; nothing deployed or merged

## Requested

Codex's bounded assignment. The check-email screen defaults unknown delivery to "We sent"; AuthGuard
redirects without params; `configured=true`/`sent=false` is mislabelled as unconfigured; resend
ignores `{verified:true, sent:false}`. UI messaging and route state only — no backend auth, schema,
token rules, payment, infra or video.

## Chronological

1. Fetched all refs and confirmed `bc0aa17`, `5d0e00f`, `9e2813a` exist before touching anything.
   Branched from `bc0aa17`; no reset, no force, nothing else moved.
2. Read the staging-isolation note and the preview-smoke-followups backlog from `9e2813a`.
3. Traced every route into `/check-email`. There are four:

   | Entry | Params passed | State before this change |
   |---|---|---|
   | `(auth)/register.tsx:90` | `email`, `sent`, `configured` | correct — the only one |
   | `(auth)/login.tsx:85` | `email` only | fell through to "We sent" |
   | `_layout.tsx:85` AuthGuard | **none** | fell through to "We sent" |
   | `verify-email.tsx:37` | none | fell through to "We sent" |

   So the false claim was the common path, not the edge case.
4. Read the resend route (read-only, unchanged): it answers **200** with `{verified:true,
   sent:false}` for an already-verified address, 429 when rate-limited, 503 when the send failed.
   The screen treated any 200 as proof and announced a link it had not sent.
5. Wrote `utils/verificationMessage.ts` as pure, import-free logic, then its tests, then wired the
   screen. Helper first so the branches could be tested without a render or a server.
6. Ran the named checks, then rendered the four param states in a real browser.

## Changed

| File | Change |
|---|---|
| `artifacts/sikshya/utils/verificationMessage.ts` | **new.** `noticeFromParams`, `noticeFromResend`, `noticeFromResendError`, returning `{tone, text}` |
| `artifacts/sikshya/utils/verificationMessage.test.ts` | **new.** 14 focused tests |
| `artifacts/sikshya/app/check-email.tsx` | derives its message instead of defaulting; reads the resend body; tone drives token colour and an icon |
| `artifacts/sikshya/app/_layout.tsx` | AuthGuard passes `email`, still no delivery claim; gate unchanged |
| `artifacts/sikshya/app/(auth)/login.tsx` | comment recording why it passes no delivery state |

Four states kept apart — **unknown**, **unconfigured**, **failed**, **sent** — plus **verified**
from a resend. `unconfigured` outranks a stale `sent=1`: a server with no provider cannot have sent
anything. A malformed flag reads as unknown, never as false.

Tone maps to existing tokens only (`success`, `warn`, `destructive`, `mutedForeground`) and is
carried by an icon as well as a colour, so "nothing was sent" is not merely a paler "sent".

## Decisions

- **Route state and resend state are separate.** The route describes what happened before the
  screen opened; a resend describes what happened on it. Collapsing them lets a stale parameter
  outlive a fresher answer.
- **Repeated navigation degrades to unknown rather than keeping a claim.** A user bounced back by
  AuthGuard has lost the parameters, and "we cannot confirm" is then the true statement. Verified in
  the browser, not only in a unit test.
- **The resend button is hidden once the server says the address is verified.** Offering to send
  another link on a screen that just explained none was needed invites repeated pressing.
- **No notice promises an inbox.** Submission is not delivery; a test asserts no output matches
  "check your inbox", "you will receive", "it has arrived".
- **Gates untouched.** AuthGuard still confines an unverified teacher or student to check-email or
  verify-email; onboarding and backend enforcement are unchanged.

## Verification

| Command | Result |
|---|---|
| `pnpm --filter @workspace/sikshya run typecheck` | clean |
| `pnpm --filter @workspace/api-server run typecheck` | clean **after `pnpm run typecheck:libs`** — see below |
| `pnpm --filter @workspace/sikshya run test` | **168 passed, 0 failed** (154 before, +14 mine) |
| `pnpm --filter @workspace/sikshya run lint:design` | no new leaks; baseline unchanged at 223 hex / 429 sizes |
| Rendered browser, 390px, built app | **14 passed, 0 failed** |

**Unit tests (14)** — absent params · configured=0 · configured=1/sent=0 · sent=1 · unconfigured
outranking a stale sent · malformed flags · array-valued params · repeated navigation ·
already-verified resend · genuine resend · a 200 confirming nothing · failed resend with and without
a server message · no notice promising an inbox.

**Rendered browser evidence (14 checks, 5 screenshots)** — the four param states plus repeated
navigation, each asserted on the visible text, on absence of "We sent a verification link", and on
zero page errors. Screenshots sent to the owner.

## Failures and what they cost

- **My own test caught my own wording.** The first "unknown" text read "cannot confirm whether a
  verification email **has already been sent** to this address" — true, but the scan for sent-claims
  flagged it, and rightly: a person skimming takes the verb, not the qualifier. Reworded to "went
  out" rather than loosening the assertion. 3 of 14 tests failed until then.
- **`api-server` typecheck failed at first** with `@workspace/db has no exported member …`. Not my
  change — I touched no server file. The root script runs `typecheck:libs` first; running the
  workspace filter alone skips the `tsc --build`. Clean once libs were built. Recorded because the
  failure looks alarming and is not.

## Not tested

- **The two resend outcomes were not rendered.** Already-verified and failed resend are covered by
  unit tests only. Rendering them needs a live API, an authenticated session and a verified fixture;
  that is Codex's staging environment, not this container. **Do not read the unit results as a
  rendered flow.**
- **Nothing was exercised against the isolated preview**, its staging API, or its Neon project.
- **No real email was sent or received.** Mail credentials are absent by design, so "sent=1" was
  rendered from a route parameter, never from a real provider acceptance.
- The 24-hour link lifetime is quoted from `EMAIL_VERIFY_HOURS`; token behaviour was not retested.

## Remaining risks

- `verify-email.tsx` also routes to `/check-email` without params. It now lands on the truthful
  unknown state rather than a false claim, which is correct, but a person arriving from a failed
  verification might be better served by wording about *that* failure. Out of this slice's scope.
- If a future caller passes `sent`/`configured` from something other than a registration response,
  the flags mean whatever that caller means. Only `register.tsx` sets them today.
- The screen still offers a resend when delivery is known to be unconfigured. Deliberate — server
  configuration can change between page load and press — but every attempt will fail until support
  finishes setup, and the message says so.
