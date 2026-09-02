# Lock teaching tiers before operator approval

- Date: 2026-09-02
- Agent: claude
- Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Base commit: `98d40c4`
- Status: complete — awaiting owner preview approval before merge

## Requested

Section 2 of `.agents/backlog/2026-09-02-owner-corrections-and-stream-poc.md`. A pending, rejected
or unverified teacher could still select a tier and open the simulated payment sheet; the refusal
only arrived after phone and PIN entry. Keep `mayBuyTeacherPlan()` authoritative on the server and
stop the payment sheet opening in the UI.

## Changed

**`artifacts/api-server/src/routes/teachers.ts`** — new `GET /teachers/me/plan-eligibility`. It
returns `mayBuyTeacherPlan()`'s verdict verbatim (`allowed`, plus `code` and `message` when
refused). Teacher-only; a student gets 403.

**`artifacts/api-server/src/lib/teachingAccess.ts`** — corrected the refusal wording. It said
"Your documents must be approved by a Sikshya operator", which misreads its own gate: it reads
`approval_status` on the profile, which is the *account* decision. A teacher can have every
document accepted and still be waiting, and that message sent them off to re-upload paperwork that
was already fine. Same document/account conflation fixed in slice 1, one layer down.

**`artifacts/sikshya/app/(teacher)/subscription.tsx`** — fetches the verdict and derives one
`planLocked` flag from it. Tier rows, both payment-method buttons and the pay button take
`disabled` and lose their `onPress` entirely when locked; `PaymentSheet` additionally takes
`visible={payVisible && !planLocked}`. Three separate banners for checking / could-not-check /
refused, the last carrying the server's own message and a link to Profile.

**`artifacts/api-server/scripts/monthly-tests/run.mjs`** — 9 new checks.

**`artifacts/api-server/scripts/tier-limits/run.mjs`** — repaired; see below.

## Decisions and assumptions

- **Only the verdict crosses the wire**, not `approvalStatus` and `emailVerified`. Handing back
  the inputs invites the client to re-derive the rule, and then there are two copies of it — the
  mistake `lib/membership.ts` exists to prevent for classroom access.
- **Fail closed, in all three uncertain states**: still checking, check failed, check said no. The
  server refuses the purchase in every one of those cases anyway, so an unlocked button would only
  walk the teacher into a refusal. On the one screen that asks for money, guessing permissively is
  the wrong guess.
- **Locked styling is muted ink on a sunk surface, not reduced opacity on the row.** The price has
  to stay legible while the tier is unavailable, and an opacity strong enough to read as "disabled"
  also makes NPR 4,700 hard to read.
- **`onPress` is removed when locked, not replaced with a handler that declines.** A row that still
  responds is a row a teacher will keep pressing.

## Verification

Local Postgres 16 on 55432, server rebuilt and restarted between changes.

| Command | Result |
|---|---|
| `pnpm run typecheck` | clean, all four packages |
| `pnpm --filter @workspace/api-server run test` | **279 passed, 0 failed** |
| `pnpm --filter @workspace/sikshya run test` | **154 passed, 0 failed** |
| `pnpm --filter @workspace/sikshya run lint:design` | no new leaks; 223 hex / 429 sizes |
| `scripts/monthly-tests/run.mjs` | **199 passed, 0 failed** |
| `scripts/admin-tests/run.mjs` | **58 passed, 0 failed** |
| `scripts/tier-limits/run.mjs` | **31 passed, 0 failed** (was completely broken — see below) |
| `scripts/session-tests/run.mjs` | 56 passed, 0 failed |
| `scripts/operator-tests/run.mjs` | 50 passed, 0 failed |
| `scripts/payment-tests/run.mjs` | 10 passed, 0 failed |

The packet's acceptance checks, all covered by passing integration checks against a live server:

- an unverified teacher is refused, and the screen is told up front
- a pending teacher is refused, and the message names the *account* decision not the documents
- a rejected teacher is refused
- an approved, email-verified teacher is allowed
- a student cannot query the teacher gate at all (403)
- calling `POST /teachers/:id/subscribe` directly as a pending teacher still returns 403

**Not verified in a browser.** Chromium is still absent from this container. The lock is covered by
server tests and by reading the component, but nobody has looked at the disabled styling.

## Problems and surprises

**Two false failures that would have been reported as bugs if taken at face value.**

1. **`NODE_ENV`.** Five monthly checks failed with 402 "Online plan payment is not connected yet".
   Nothing to do with my change: `chargeForMonthly` deliberately refuses a *teacher plan* in
   simulated mode unless `NODE_ENV === "test"`, because a plan grants the right to sell classes and
   a real server must never accept an unverifiable payment for one. My local `.env` said
   `development`. CI sets `NODE_ENV=test` for exactly this reason.

2. **A stale server.** The first run of the new endpoint 404'd. `pnpm run dev:api` serves a built
   `dist/index.mjs`, so source edits need a rebuild, not just a restart.

**`pkill -f` killed my own shell** (exit 144), precisely as `.agents/memory/ci-restart-by-pid.md`
warns. Killed by pid instead, per that note.

**`scripts/tier-limits/run.mjs` was completely broken and nothing had noticed.** It is not wired
into CI. Two causes, both from work that landed after it was written:

- Its `approve()` helper set `approval_status` only. Account verification later added an email gate
  *in front* of it, so every teacher in the suite failed with "Verify your email before creating a
  class." Ten checks about the tier allowance were reporting a 403 from a different gate entirely.
- It spawns its own server without loading the repo `.env`, so it never had `NODE_ENV=test`.

It also asserted `subscribing succeeds` for a *pending* teacher — behaviour the product has since
deliberately removed. I rewrote that block against the stronger contract rather than restoring the
old assertion: a tier cannot be bought until both human gates are open, an account cannot be
approved over unreviewed documents (409), and only then does the purchase go through. It still
proves the original hole — that buying a tier does not approve a teacher — is shut.

## Fabrications found

None on this screen this time. The plan card's fictional payment history and non-existent
"session recording" feature were removed in an earlier pass; nothing new surfaced.

Worth recording that the screen still keeps **its own copy of the tier price table**
(`SUBSCRIPTION_TIERS` in `subscription.tsx`) while the server owns it in `lib/tierLimits.ts` and
publishes it at `GET /subscription-tiers`. They agree today. A price that disagrees is a financial
bug. Already logged in `ui-upgrade-progress.md`; not fixed here because it is a data-flow change
rather than a lock, and this slice was meant to stay small.

## Deliberately not changed

- **`mayBuyTeacherPlan()`'s logic.** Only its wording. It was already correct and authoritative.
- **The subscribe route's 403.** Preserved exactly, for direct API calls, stale clients and deep
  links, as the packet requires.
- **`ordinaryTeachingAccess()`'s messages.** Different gate, different slice.
- **The app's duplicate tier price table.** See above.
- No schema change, no migration beyond `db:push` against the local test cluster, no deploy.

## Remaining risks / next pickup point

- **No browser verification.** Same limitation as slice 1.
- **`tier-limits` is still not in CI.** I repaired it, but nothing will stop it rotting again. Worth
  a line in the workflow; not added here because CI changes affect every run and belong in their
  own commit.
- Next: section 3, the password reset. The packet reports a two-day-old link that worked while the
  code declares a 30-minute expiry — that reproduction is the first task, before changing anything.
