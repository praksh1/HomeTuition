# Session-proof corrections: the release blockers from review

- Date: 2026-09-05
- Agent: claude
- Branch: `claude/session-proof-provider`
- Base commit: `3241264` (my own earlier work on this branch)
- Status: complete. **Not merged, not deployed, no `db:push` run anywhere, no dashboard touched,
  nothing purchased.**

Supersedes several statements in `2026-09-05-claude-session-proof-provider.md`; the corrections are
listed under **Fabrications found** below.

## Requested

Two rounds of review on the Tier 3–4 session-proof work, treated as one correction cycle: five
release-blocking defects, then eight further blockers from a full code review (A–H). Re-run the
full gates, break each new guard to prove it goes red, keep the worklog exact, and report that
webhook activation may stay blocked because it may need a billing card the owner forbids.

## Changed

**New**
- `artifacts/api-server/src/lib/sessionProof/webhookSignature.ts` + `.test.ts` — Daily's signing
  scheme, the replay window and the activation probe. 17 tests.
- `artifacts/api-server/src/lib/sessionProof/retentionSweep.ts` — aggregate-before-delete, in one
  transaction. Imported by nothing.
- `artifacts/api-server/src/lib/video/participantIdentity.ts` — `providerUserId`, pure so the
  36-character cap is testable without the network.
- `lib/db/src/schema/sessionProofAggregates.ts` — the durable per-class summary.
- `artifacts/api-server/scripts/retention-sweep/run.mjs` — 28 checks, registered as `test:retention`.
- `SESSION-PROOF.md` — what is switched off, what could not be verified, and what must be true
  before any of it is turned on.

**Modified**
- `routes/sessionProof.ts` — rewritten verification; activation probe answered first and unsigned;
  200 for everything verified-but-ignored; session existence and class-window checks before insert;
  provider user ids correlated against `getSessionMembership`; advisory lock around the telemetry
  read-then-write; `providerEventsFor` now carries meeting id, clock source and identity outcome.
- `lib/sessionProof/providerEvents.ts` — event-specific occurrence timestamps, `eventAtSource`.
- `lib/sessionProof/aggregate.ts` — per-meeting instances; single-span figure withheld when there
  was more than one meeting; three new caveats; owner flag explicitly excluded from identity.
- `lib/sessionProof/telemetryBounds.ts` — `observationWindow`, pure, with the clock passed in.
- `lib/sessionProof/retention.ts` — `summariseExpiring`, pure, so the arithmetic that decides what
  survives a deletion is testable without a database.
- `lib/daily.ts`, `lib/video/types.ts`, `echoProvider.ts`, `routes/sessions.ts` — the authenticated
  user id threaded to the provider.
- `lib/db/src/schema/sessionProviderEvents.ts` — `event_at_source`, `identity_rejected`, and a real
  foreign key on `participant_user_id` with `ON DELETE SET NULL`.
- `lib/ensureSchema.ts` — the two new columns, the new constraint (guarded on `pg_constraint`,
  `NOT VALID` so boot does not scan), and the aggregates table.
- `routes/admin.ts` — the class's own teacher seeded into the evidence page.
- `app/(admin)/ticket/[id].tsx` — meeting instances listed separately, never added up.
- `scripts/session-proof/run.mjs` — rewritten to the new contract; 94 checks.

## Decisions and assumptions

**The activation probe is answered before the configuration check, and unsigned.** Creating a Daily
webhook is what *returns* the signing secret, and the probe fires during that same call — so it
necessarily arrives at a deployment where the secret is not set. Answering 404 there is a deadlock
in which the endpoint can never be activated at all. It is safe because answering does nothing:
exactly the body `{"test":"test"}`, nothing stored, nothing read, and a configured and an
unconfigured deployment answer it identically, so it is not an oracle either.

**Everything verified but not stored answers 200, not 202 or 4xx.** Daily deactivates a webhook
whose endpoint keeps failing. A stream of event types this product deliberately ignores must not
read as a fault, or ingestion dies silently and permanently. Bad signatures still answer 401 —
Daily never sends one, so a 401 can only ever be somebody else's traffic and cannot count against
the webhook.

**An event for a class that does not exist is not stored; one from outside its class's window is
stored unattached.** The first is somebody else's room or a leftover and there is nothing to say
about it. The second keeps its room name, so "deliveries are arriving and failing to correlate" is
visible — otherwise it is indistinguishable from "nothing is arriving".

**The class-correlation window is ±12 hours.** Far wider than any real overrun, far narrower than
"some other day". This is what stops a reused room stretching one lesson's recorded span across a
gap.

**The foreign key on `participant_user_id` became safe only because of the membership check.** The
earlier comment said it was deliberately not a key, because a value from outside must not be able
to fail an insert. That reasoning was right at the time. Now the route resolves the claim against
`getSessionMembership` and nulls anything that is not a member of that class, so nothing that
reaches the column can fail — and account deletion nulls it instead of leaving a durable internal
identifier behind.

**Two columns were added to `session_provider_events` rather than a third table.** The
new-tables-not-new-columns rule exists because the API redeploys itself while `db:push` is manual,
so a column added to a table old code reads with a bare `select()` is a 500 in that window. That
table is new on this unmerged branch and no deployed code reads it, so the rule does not apply.

**`sanitiseQualitySamples`'s window is computed by a pure function taking `now` as an argument.**
The bug being fixed was invisible precisely because it depended on the wall clock; a rule that
needs a real elapsed month to exercise is a rule nobody tests.

**Retention writes a summary before deleting, and locks the rows it counts.** `FOR UPDATE` pins
exactly the rows summarised so the ids counted and the ids deleted are the same set; deleting by
age instead would sweep away anything that arrived in between, uncounted. A second sweep adds to
the existing summary rather than replacing it, because a class can expire in pieces.

## Verification

Every suite below was run against a real Postgres (`postgres://…:55432/sikshya`), not read.

| Gate | Result |
|---|---|
| `pnpm run typecheck` (4 packages) | clean |
| `pnpm --filter @workspace/api-server run test` | **378 passed, 0 failed** (was 336) |
| `pnpm --filter @workspace/sikshya run test` | **215 passed, 0 failed** |
| `test:proof` | **94 passed, 0 failed** (was 36) |
| `test:retention` (new) | **28 passed, 0 failed** |
| `test:video` | 16 passed, 0 failed |
| `test:attendance` | 72 passed, 0 failed |
| `test:refunds` | 152 passed, 0 failed |
| `lint:design` | no new leaks; 205 hex / 418 sizes unchanged |
| `git diff --check` | clean |

Both integration suites were run three times against the same database to prove they are
re-runnable.

### Deliberate breaks — each proven red, then restored

| # | Guard removed | Result |
|---|---|---|
| 1 | the timestamp prefix in the signed input | 374 pass / **4 fail** |
| 2 | decoding the secret from base64 | 370 pass / **8 fail** |
| 3 | the base64 digest | 374 pass / **4 fail** |
| 4 | the replay window | unit 377 / **1 fail** · proof 92 / **2 fail** |
| 5 | the activation probe being exactly `{"test":"test"}` | unit 377 / **1 fail** · proof 93 / **1 fail** |
| 6 | checking the class exists before storing | proof 91 / **3 fail** |
| 7 | refusing to attach an event from outside its class's window | proof 93 / **1 fail** |
| 8 | correlating a provider's user id to real membership | proof 90 / **4 fail** |
| 9 | timing a row by the event's own clock | unit 375 / **3 fail** · proof 91 / **3 fail** |
| 10 | keeping meeting instances apart | unit 376 / **2 fail** |
| 11 | bounding the observation window to the class's own end | unit 376 / **2 fail** · proof 90 / **4 fail** |
| 12 | serialising telemetry writes per person per class | proof 92 / **2 fail** |
| 13 | seeding the class's own teacher into the evidence page | proof 90 / **4 fail** |
| 14 | summing each meeting's own span rather than spanning them | retention 25 / **3 fail** |
| 15 | the owner flag never standing in for an identity | unit 376 / **2 fail** |

All fifteen went red, and the tree was restored and re-verified green afterwards. Unlike the last
round, no break failed to fire.

## Problems and surprises

**`docs.daily.co` is blocked by this environment's network egress proxy.** `WebFetch` returns
`EGRESS_BLOCKED`. So the signing algorithm **could not be checked against Daily's own
documentation** by the agent that implemented it; it is written from the contract stated in review.
The tests prove the code matches that specification. They do not prove the specification matches
Daily. This is recorded in the file itself, in `SESSION-PROOF.md`, and again below.

**The suite's own fixtures were outside the correlation window and hid three real passes as
failures.** Events were timed "now" against a class scheduled two days out, so the new window check
correctly refused to attach them. The fixtures were wrong, not the guard — but for about a minute
it read the other way round, which is exactly how a correct guard gets softened to make a suite go
green. Events are now timed to the class's own scheduled instant.

**`psql -tAc` prints its command tag as well as the returned row.** An `INSERT … RETURNING id` came
back as `113\nINSERT 0 1`, so every id was `NaN`. `-q` fixes it. Worth recording because the
failure surfaces as a SQL syntax error about a column called "nan", which points nowhere near the
cause.

**`express.json()` refuses a JSON string body with its own 400 before the route sees it.** Harmless
— Daily only ever sends objects — but the suite now asserts that 400 deliberately rather than
expecting a 200 that can never arrive.

**I repeated a mistake already recorded in my own previous worklog:** the first retention suite
asserted absolute row counts and so passed once and failed on its second run. Fixed by scoping
every assertion to the run's own class. The note existed; I did not re-read it before writing the
suite.

## Fabrications found

Three, all mine, all from the previous round on this branch, and all now false in the code as well
as corrected here:

1. **"Daily cannot tell us which account joined"** — stated as a load-bearing finding in
   `2026-09-05-claude-session-proof-provider.md` and repeated in four code comments. It was true
   only because token minting omitted `user_id`. It now carries one, and every one of those
   comments has been rewritten.
2. **"Adding a `user_id` claim is a one-line change, deliberately not made, since altering a
   working token path was not in scope."** Reasonable at the time and wrong in effect: without it
   the entire provider corroboration could say nothing about a person, which is the only thing a
   refund argument asks. It was in scope; I had scoped it out.
3. **The webhook signature verification itself.** Not a fabrication in a summary but the same class
   of error: a confident implementation of a contract nobody had checked, whose tests agreed with
   it because they were written from it. Four independent departures from Daily's scheme, each
   individually fatal.

Added to `.agents/backlog/ui-upgrade-progress.md`.

## Deliberately not changed

- **No Daily dashboard change, no webhook registered, no key created, no card added, no plan
  changed.** `DAILY_WEBHOOK_SECRET` is set nowhere in this repository.
- **No `db:push` against production or staging.** Local throwaway Postgres only.
- **The retention sweep is not scheduled and not called.** Nothing imports it; `test:retention`
  asserts that.
- **Nothing sends connection telemetry.** The endpoint and its bounds exist; no app screen calls
  it. The server contract was worth reviewing before a client was changed to feed it.
- **Payments, refunds and Daily itself untouched.** No account created, nothing purchased, no
  recording enabled.
- **Not merged, not deployed.**

## Remaining risks / next pickup point

1. **The signing algorithm is unverified against Daily.** Confirm it against current documentation
   before ingestion is enabled. This is the single highest-value follow-up.
2. **Activation may be blocked by billing.** Registering a webhook may require a card on the Daily
   account. This could not be checked and nothing was bought. It is possible this path stays off
   indefinitely — plan for that rather than around it.
3. **A no-purchase alternative exists and has not been built.** Reconciling meetings by calling
   Daily's REST API after a class, instead of receiving webhooks. Trade-offs written up in
   `SESSION-PROOF.md`; it needs its own decision, not a quiet start.
4. **No real webhook has ever been received.** One genuine delivery must be verified end to end,
   and the accepted payload shapes then narrowed to what Daily actually sends.
5. **Retention scheduling is a separate approval.** It must not be switched on before ingestion has
   been proven, because deleting rows nobody verified is deleting the chance to find out they were
   wrong.
6. **Legacy anonymous events stay anonymous.** Calls joined before tokens carried an id can never
   be attributed. The operator page says so and does not guess from the owner flag.
