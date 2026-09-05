# Tiers 3–4: independent provider corroboration and operator readability

- Date: 2026-09-05
- Agent: claude
- Branch: `claude/session-proof-provider`
- Base commit: `07a1bf5` (`origin/main`)
- Status: complete for Tiers 3–4 as scoped. **Not merged, not deployed, no `db:push` run anywhere.**

## Requested

Owner priority, Tiers 3–4 of session proof-of-delivery. Codex owns Tiers 1–2. Daily stays active;
no payment or refund outcome altered; no accounts, keys, purchases or recording.

## Audit (Tier 3.1), and the finding that shapes everything else

| Thing | State |
|---|---|
| Room ↔ session mapping | `sanitizeRoomName` in `lib/daily.ts` builds `"sikshya" + id`. Reversible for integer ids; **lossy in general**, so the inverse is written strict |
| Daily meeting token | sets `room_name`, `is_owner`, `user_name`, `exp` — **and no `user_id`** |
| `session_participation` | socket-written ledger: presence, join count, board writes, messages |
| `sessionEvidence.ts` | import-free findings, no verdicts |
| Boot guard | `ensureSchema.ts`, create-only, failure-isolated, never a migration system |
| Raw body for HMAC | already captured in `app.ts` as `req.rawBody` for the payment webhook |

**The load-bearing finding: Daily cannot tell us *which account* joined.** Tokens carry no `user_id`,
so the provider can distinguish an owner from a non-owner and nothing more. Every downstream design
choice follows from this, and it is the main reason this is not a refund judge. Adding a `user_id`
claim is a one-line change to `lib/daily.ts` — **deliberately not made**, since altering a working
token path was not in scope. The normalizer reads the field anyway, so adding it later needs no
change here, and a test proves it is carried through when supplied.

## Files

**New — pure, import-free, clocks injected**
- `lib/sessionProof/providerEvents.ts` — normalize/correlate/reject a Daily webhook
- `lib/sessionProof/aggregate.ts` — combine ledger + provider + telemetry; `Measured<T>`
- `lib/sessionProof/telemetryBounds.ts` — sanitise client reports
- `lib/sessionProof/retention.ts` — plan a 30-day window; **no job, no delete**
- four matching `.test.ts` files (42 tests)

**New — persistence and routes**
- `lib/db/src/schema/sessionProviderEvents.ts`, `sessionQualitySamples.ts`
- `artifacts/api-server/src/routes/sessionProof.ts` — `POST /webhooks/daily`, `POST /sessions/:id/quality`, plus `providerEventsFor` / `qualitySamplesFor`
- `artifacts/api-server/scripts/session-proof/run.mjs` — 36 integration checks

**Modified**
- `lib/db/src/schema/index.ts` — export the two tables
- `artifacts/api-server/src/lib/ensureSchema.ts` — `ensureSessionProofTables()`
- `artifacts/api-server/src/index.ts` — boot call, failure-isolated
- `artifacts/api-server/src/routes/index.ts` — mount
- `artifacts/api-server/src/routes/admin.ts` — additive `proof` on the ticket evidence
- `artifacts/sikshya/app/(admin)/ticket/[id].tsx` — operator timeline, existing styles only
- both `package.json` — `test:proof`

## Schema / DDL steps deliberately NOT run

- **No `pnpm run db:push` against production or staging.** Run locally only, against a throwaway
  Postgres on `localhost:55432`.
- **No migration file written.** `ensureSessionProofTables()` follows the existing create-only boot
  pattern; anything beyond adding empty additive tables belongs in `db:push` where a human sees it.
- **No Daily dashboard change**, no webhook registered, no key created. `DAILY_WEBHOOK_SECRET` is
  set nowhere in this repository.
- **No retention job, cron or destructive task.** `planRetention` returns data and deletes nothing.

## Tests

| Suite | Result |
|---|---|
| `pnpm run typecheck` (4 packages) | clean |
| `pnpm --filter @workspace/api-server run test` | **336 passed, 0 failed** (42 new) |
| `pnpm --filter @workspace/sikshya run test` | **215 passed, 0 failed** |
| `pnpm --filter @workspace/sikshya run lint:design` | no new leaks; 205 hex / 418 sizes unchanged |
| `test:proof` (new) | **36 passed, 0 failed**, re-runnable |
| `test:video` | 16 passed, 0 failed — provider seam unchanged, Daily still default, echo unchanged |
| `test:attendance` | 72 passed, 0 failed |
| `test:refunds` | 152 passed, 0 failed |
| `git diff --check` | clean |

## Deliberate breaks — each proven red, then restored

| # | Guard broken | Result |
|---|---|---|
| 1 | room-name anchor `^…$` → substring | 11 pass / **1 fail** |
| 2 | timestamp plausibility window removed | 11 pass / **1 fail** |
| 3 | `unavailable()` returns a zero | 7 pass / **6 fail** |
| 4 | null provider `user_id` → zero join count | 12 pass / **1 fail** |
| 5 | telemetry accepts any word as a bucket | 9 pass / **1 fail** |
| 6 | retention deletes the boundary row | 6 pass / **1 fail** |
| 7 | signature verification always true | 32 pass / **4 fail** |
| 8 | `onConflictDoNothing` removed | 35 pass / **1 fail** |
| 9 | role sourced from the client body | **35 pass / 0 fail — the test was wrong** |
| 10 | unconfigured endpoint names its variable | 34 pass / **2 fail** |

**Break 9 is the most valuable thing in this list.** It did *not* go red, which meant the guard was
untested rather than working. The spoof attempt sat in a later block where the rate limit refused it
before anything was written, so the role source was never exercised. The spoof now rides on the
request that actually stores a row, plus an assertion that the row belongs to the authenticated
caller and not the body's user id — and the same break then goes red. Without the exercise this
would have shipped as a green guard nobody had checked.

Two of my own bugs, both caught by running rather than reading: `===` binding tighter than `??` so
an "untouched" assertion compared against `undefined`, and absolute row counts making the suite pass
once and fail on its second run. It is now scoped to a per-run tag and re-runnable against the same
database, which matters because it may be pointed at a shared development one.

## Known limitations

- **The provider cannot name a participant.** Owner/non-owner only. Everything about "which teacher
  was in the room" still rests on this app's own socket.
- **Daily's webhook envelope is not confirmed against vendor documentation.** The normalizer is
  tolerant about where fields sit and strict about usability, and rejects with a reason. Before this
  is enabled against real traffic, the accepted shapes must be narrowed to Daily's current schema.
  Until then a rejection count in the logs is expected, not alarming.
- **No real webhook has ever been received.** Every test posts a locally-signed body.
- **Client telemetry is unverifiable by construction** — a number a device chose to send about a
  dispute its owner may be party to.
- **Nothing sends telemetry yet.** The endpoint and bounds exist; the Daily embed is not yet wired
  to report quality changes, so `session_quality_samples` stays empty in practice. Deliberate: the
  server contract is worth reviewing before a client is changed to feed it.
- **`test:proof` needs Postgres and builds `dist`**; it is not in CI.

## Privacy and retention

Stored: provider, event id/type/time, session id, room, meeting/participant ids, owner flag,
duration; and for telemetry one of four words, a reconnect flag and a timestamp.

**Not stored, and asserted by tests:** raw payloads, signatures, tokens, participant names, IP
addresses, device identifiers, audio/video anything, jitter, packet counts, bitrates, ICE
candidates.

Retention target is **30 fixed days** for fine-grained rows — days rather than a calendar month for
the reason already recorded about Bikram Sambat and Gregorian months giving one policy two answers.
`DurableSessionProofAggregate` records the shape that should outlive them: counts and spans, never
per-sample timestamps, because after the dispute window "the teacher's device reported three bad
periods" is a fact about a lesson and "at 19:42:11 this person's connection was bad" is surveillance.

**No deletion is implemented.** Wiring one needs its own review; a scheduled job that removes
evidence must not appear quietly in a diff, and the aggregate must be written before anything is
removed, in one transaction.

## Why this is NOT yet safe as an automatic refund judge

1. **The corroborating source cannot identify people.** A rule reading "the provider confirms the
   teacher was absent" would be reading owner/non-owner flags. The strongest available statement is
   "somebody with moderator rights was in the room".
2. **Its envelope is unconfirmed and it has never run against real traffic.** A parser that silently
   rejects everything looks identical to a provider that saw nothing — the difference is a log line
   nobody is watching yet.
3. **Absence is ambiguous.** A missing webhook could be a class that never happened, a delivery that
   failed, an unregistered webhook, or a table that does not exist. `aggregate.ts` distinguishes
   these for a *reader*; no rule can safely collapse them.
4. **Telemetry is self-reported by an interested party**, and a device that never reported is not a
   device that had no trouble.
5. **Sources will disagree**, and disagreement is the most interesting fact in the file — a thing to
   read, not to resolve automatically.
6. **The policy forbids it.** REFUNDS.md section 3: rules over evidence produce a recommendation and
   *a person decides*. This change stops one step earlier than even that: it produces no
   recommendation at all, and a test asserts the words refund, recommend, verdict, at fault and
   entitled appear nowhere in an evidence summary.

## Next pickup

Confirm Daily's envelope against current docs and narrow the accepted shapes; decide whether to add
a `user_id` claim to token minting (one line, unlocks real attribution); wire the embed to report
quality changes; and review the retention deletion separately.
