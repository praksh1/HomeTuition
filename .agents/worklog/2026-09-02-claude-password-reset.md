# Password reset — diagnosis, security and UX

- Date: 2026-09-02
- Agent: claude
- Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Base commit: `c2b47b0`
- Status: complete — the reported defect was **not reproduced**; see below

## Requested

Section 3 of the correction packet. Reproduce and identify the cause of a reset link that appeared
to work two days after issue, then fix the flow: enumeration-safe responses, one-time 30-minute
tokens, older tokens invalidated, current password rejected, show/hide controls, a confirmation
state and a server-enforced 60-second resend cooldown.

## Status of the reported defect: UNREPRODUCED — open, not explained, not fixed

Stated first because the rest of this section is easy to misread as a diagnosis. **It is not one.**
Nothing below explains what happened to the owner. Every check I could run says an expired link is
refused, which means either the link was not what it appeared to be, or the failure is somewhere I
could not reach from this container. Both remain open.

What is **not** claimed:

- Not that it is fixed. No behaviour that could have caused it was changed, because nothing was
  found to change.
- Not that the owner was mistaken. The alternative below is a hypothesis with no evidence for it
  beyond being possible.
- Not that local checks clear the deployed system. Everything here ran against a **local** server
  and database. The deployed API was never exercised, and the owner's link was.

**Still to do, and it needs the owner.** Run the same expired-token check against the deployed API
once a preview exists, for the two routes *separately*:

| | Emailed link | Legacy operator code |
|---|---|---|
| Table | `account_tokens` | `password_resets` |
| Endpoint | `POST /auth/password/reset` | `POST /admin/users/:id/password-reset` then the code flow |
| Shape | 64-char hex in a `/reset-password?token=…` URL | six digits read out over the phone |
| Lifetime | 30 minutes | 30 minutes |

This entry does not establish which one the owner actually used, and that alone could decide it. If
they still have the email, the `/reset-password?token=` path identifies it as the emailed route
immediately.

## What was checked, and what it rules out

The packet was explicit that this needed diagnosis rather than another expiry check, and it was
right to be. Everything I could test says the expiry works.

- **Planted a token expiring two days ago and used it.** Refused, 400. Repeated at one second past
  the thirty-minute boundary: also refused.
- **Read both reset paths.** The emailed-link path (`consumePasswordReset`) checks
  `expires_at >= now()`, `used_at is null`, and takes `for update`. The older operator reset-code
  path (`admin.ts`) checks its own expiry the same way. Neither has a hole.
- **Checked the schema.** `account_tokens.expires_at` is `timestamp with time zone`, so the
  timezone hypothesis in the packet does not apply.
- **Checked for a stale production build.** `git diff origin/main` on `accountSecurity.ts` is
  empty — production runs byte-identical code. The 2026-08-31 activation log notes production "still
  ran the old `main` code", but `main` and this branch do not differ in this file.
- **Checked the client.** `apiPost` throws on any non-2xx and `reset-password.tsx` only sets its
  success state inside `try`, so a refusal cannot render as success.

**One hypothesis, offered as a hypothesis.** Every reset email was word-for-word identical, with
the subject "Reset your Sikshya password" and the only timing information being "expires in 30
minutes" — meaningful solely at the moment of reading. Mail clients thread on subject, so a second
request collapses into the same conversation as the first and the two are indistinguishable.
Requesting a new link (which silently invalidates the old one) and then opening the thread would
look exactly like using the original. **There is no evidence this is what happened.** It is
consistent with the report and with the code; so are other things I could not test from here.

I have not changed the expiry logic, because nothing indicates it is wrong and the packet warned
against cargo culting. What did change is that every reset email now carries an absolute issue time
and expiry time in Nepal time and says only the newest link works — **not a fix, an instrument**. It
does not make the defect go away. It makes the next occurrence answerable, because the email will
name its own issue time and the owner can read it off directly.

## Changed

**`artifacts/api-server/src/lib/accountSecurity.ts`**
- `consumePasswordReset` now takes the plaintext and returns `"ok" | "invalid" | "same_password"`.
  It loads the current hash inside the transaction, after `for("update")`, and compares with
  `verifyPassword`. **Never hash-to-hash**: scrypt salts every hash, so comparing the strings would
  never match and would be a no-op that looked like a check.
- On `same_password` the token is deliberately **left unused** — the person holds a valid link and
  typed the wrong thing; burning it would cost them another email for a typo.
- Reset emails carry absolute issue/expiry times and a distinct subject line.
- `PASSWORD_RESEND_SECONDS` exported so the UI countdown and the server rule are one number.

**`artifacts/api-server/src/routes/auth.ts`** — passes the plaintext; returns 400 with
`code: "SAME_PASSWORD"`; returns `resendAfterSeconds` from `/forgot`; returns
`otherSessionsSignedOut: false` from `/reset`.

**`artifacts/sikshya/app/forgot-password.tsx`** — a real submitted state. The form and submit
button are replaced by a confirmation, a Resend button that is disabled with a visible countdown,
and a route back to sign-in.

**`artifacts/sikshya/app/reset-password.tsx`** — extracted `PasswordField` with an independent
show/hide toggle per field, 44pt target, and an accessibility label that flips between "Show
password" and "Hide password".

**`artifacts/api-server/scripts/password-reset/run.mjs`** — new suite, 25 checks. Registered as
`pnpm --filter @workspace/api-server run test:reset`.

## Decisions and assumptions

- **`resendAfterSeconds` is a constant, not the real remaining cooldown.** Returning the true
  remaining time would answer "does this address have an account?" for anyone who asked twice,
  undoing the generic message it sits beside. Asserted in the suite.
- **Visibility is per field.** Revealing the new password must not reveal the confirmation, or the
  confirmation stops confirming anything.
- **Sessions elsewhere are not revoked, and the app now says so.** Auth is a stateless JWT with no
  session record and no version to bump. Claiming "signed out everywhere" would be exactly the kind
  of untrue reassurance this packet exists to remove. Written up as `HANDOVER.md` §8.9 with the
  real fix (a `session_version` column plus a middleware check) and the question of whether it
  blocks launch.
- **The legacy operator reset-code route is kept.** It is the support desk's only way to help
  somebody with no working email, it is 30-minute and single-use like the link, and its code is
  never logged. It is not a never-expiring back door.

## Verification

| Command | Result |
|---|---|
| `pnpm run typecheck` | clean, all four packages |
| `pnpm --filter @workspace/api-server run test` | 279 passed, 0 failed |
| `pnpm --filter @workspace/sikshya run test` | 154 passed, 0 failed |
| `pnpm --filter @workspace/sikshya run lint:design` | no new leaks; 223 / 429 |
| **`scripts/password-reset/run.mjs`** | **25 passed, 0 failed** |
| `scripts/admin-tests/run.mjs` | 58 passed, 0 failed |
| `scripts/operator-tests/run.mjs` | 50 passed, 0 failed |
| `scripts/monthly-tests/run.mjs` | 199 passed, 0 failed |

Every test the packet asked for, all passing against a live server and database:

- known and unknown addresses return identical status, message and cooldown
- a token works once, fails on second use, fails after 30 minutes, fails at two days old
- issuing a second token spends the first, and the first then fails
- the current password is refused with its own code; a different one succeeds
- **the link survives the same-password refusal** and still works afterwards
- two simultaneous submits produce exactly one success, and no unused token is left
- the token never reaches the activity log

**Not verified:** the two UI cases (the confirmation state hiding the form, and the show/hide
toggles under keyboard and screen reader). Chromium is still missing from this container. These are
the two items in the packet's test list I could not execute, and they need a human on the preview.

## Problems and surprises

- **There were no tests for this flow at all** before this slice, which is why a defect report about
  it had nothing to check itself against.
- The suite cannot read a token the server emailed, because only a SHA-256 hash is stored — correct
  behaviour that makes testing awkward. Tokens are planted with a known plaintext instead, which
  exercises the identical consume path.
- The "issuing a new link spends the old one" test needed the planted row backdated past the
  60-second window first, or the server correctly declines to issue at all.

## Fabrications found

One, and it is the mirror image of the usual kind — not an invented number but an **invented
reassurance**: the reset screen implied a completed password reset secured the account, while every
device already signed in stayed signed in. Now stated plainly on the screen and in `HANDOVER.md`
§8.9.

## Deliberately not changed

- **The expiry logic.** Nothing indicates it is wrong; four separate checks say it is right.
- **The operator reset-code route.** See above.
- **Session revocation.** Needs a schema change; §8.9.
- **`hashPassword` is no longer called in the route** but remains imported there for registration
  and password change — not removed.

## Remaining risks / next pickup point

- **The two-day-link report is unexplained, not disproved.** If the owner is certain, the new
  timestamped emails will settle it on the next occurrence. Worth asking them to keep the email.
- **Two UI checks are unrun.** They need the preview.
- Next: section 4, the audited expiring test-teaching entitlement. Note for that slice —
  `chargeForMonthly` already refuses a simulated teacher-plan payment unless `NODE_ENV=test`, so the
  "no fake receipt" rule is partly enforced already and the entitlement must sit beside that rule
  rather than around it.
