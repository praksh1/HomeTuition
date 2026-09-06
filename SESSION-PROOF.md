# Proving a class happened

What the platform can honestly say about a lesson after the fact, where each part of that comes
from, and what is deliberately switched off.

Read this before turning anything in it on.

---

## Why this exists

When a student says "the teacher never showed up" and the teacher says "I was there the whole
time, your app dropped me", somebody has to decide who gets the money. Today that decision rests
entirely on **our own record** — the classroom socket writes who was connected and for how long
into `session_participation`.

That record is the right primary source and it has one weakness a real argument will find: a
teacher disputing it is disputing the very thing being used against them, and there is nothing
independent to check it against.

Daily saw the same call. Its webhooks are a second account of the same hour, produced by somebody
with no stake in the outcome. Where the two agree, a finding is much harder to argue with. Where
they disagree, **that disagreement is the most interesting fact in the file** — something for a
person to read, never something for a rule to resolve.

---

## Everything here is currently off

| Thing | State |
|---|---|
| Webhook ingestion | **Off.** `DAILY_WEBHOOK_SECRET` is set nowhere, and with no secret the endpoint answers 404 |
| A registered Daily webhook | **None created.** No Daily dashboard change of any kind was made |
| Connection-quality reporting | **Nothing sends it.** The endpoint and its bounds exist; no app screen calls it |
| Retention deletion | **Never runs.** Nothing imports it, nothing schedules it, and a test asserts that |
| `db:push` against production or staging | **Never run** for these tables |

The tables are created at boot by `ensureSchema.ts` in the create-only, failure-isolated way every
other table in this project is. If that fails the server still starts, classes still run, and the
operator page says the provider source is unavailable — which is the honest answer.

---

## What Daily can and cannot tell us

**It can say a meeting happened in a room, when it started and ended, and when participants came
and went.** Room names map one-to-one to classes: `sikshya42` is session 42.

**It can now name an account.** Meeting tokens carry the authenticated Sikshya user id, so
`participant.joined` can say *which* person rather than only "somebody with moderator rights".
This is identity, never permission — rights come from `getSessionMembership` and nothing else, and
a user id arriving back from Daily is checked against that class's real membership before it is
believed.

**It cannot name anyone on an older call.** Calls joined before tokens carried an id, and rooms
opened by hand in the Daily dashboard, produce events that stay anonymous. The operator page says
so rather than guessing, and it never infers "an owner joined, and the teacher is the only owner,
so it was the teacher" — that is a guess wearing corroboration's clothes.

---

## Daily contract verification (official documentation checked 2026-09-05)

### 1. The signing algorithm is confirmed

The original build environment could not reach `docs.daily.co`. Codex subsequently checked the
current official documentation at <https://docs.daily.co/reference/rest-api/webhooks>. It confirms
this contract:

```
key       = base64-decode(DAILY_WEBHOOK_SECRET)
input     = <X-Webhook-Timestamp> + "." + JSON.stringify(<parsed body>)
signature = base64( HMAC-SHA256(key, input) )
```

compared in constant time against `X-Webhook-Signature`, with the timestamp required to be within
five minutes.

An earlier version of this file got that wrong in four independent ways at once and its own tests
passed, because they signed with the same helper the verifier used. The tests now spell the scheme
out longhand, and the scheme matches Daily's published contract. Daily also documents the
`X-Webhook-Signature` and `X-Webhook-Timestamp` headers and its `{"test":"test"}` activation probe.

### 2. No real webhook has ever been received

Every test posts a locally-signed body. A verifier that rejects everything and a provider that
sends nothing look identical from the outside, and the difference is a log line nobody is watching
yet.

**Before ingestion is enabled against real traffic, one genuine delivery must be verified end to
end** and the accepted payload shapes narrowed to Daily's current schema. Until then, treat a
rejection count in the logs as expected rather than alarming.

### 3. Published event fields are confirmed; a real delivery is still required operationally

Daily's published `participant.joined` and `participant.left` payloads include `session_id`,
`user_id`, `room`, and their relevant timestamps; `participant.left` also includes `duration`.
Daily recommends using the top-level webhook event `id` as an idempotency key because delivery can
be duplicated or arrive out of order. This implementation does that and additionally applies a
participant-connection uniqueness guard using event type plus `payload.session_id`.

Daily's published `meeting.started` and `meeting.ended` payloads use `meeting_id`; the ended event
also publishes `start_ts` and `end_ts`. The parser's other accepted meeting-id aliases are
compatibility fallbacks, not claims about Daily's current schema.

Official documentation settles the static contract. One genuine callback is still required to
prove the account configuration, endpoint reachability, signature verification, correlation and
storage work together in the deployed environment.

---

## Activation may be blocked, and no purchase was made

Daily's official REST reference labels the webhook management endpoints **Pay-as-you-go**. The
documentation checked does not explicitly say whether merely registering one requires a billing
card, so we must not assume it is available on the current account.

**Nothing was bought, no card was added, no plan was changed, and no webhook was created.** The
owner has said purchases are not authorised, and that stands.

So it is possible that this whole path stays switched off indefinitely. That is worth knowing
before anyone plans around it.

### The no-purchase alternative, to be evaluated separately

If webhooks turn out to need a card, the same corroboration can probably be had by **asking Daily
rather than waiting for it to tell us**: after a class ends, call Daily's REST API for that room's
meeting sessions and record the same few facts. It would be a scheduled read rather than a push.

The trade-offs, honestly:

- **In its favour:** no webhook registration, no signing secret, no public endpoint, and it uses
  the API key the platform already has.
- **Against it:** it is a poll, so it costs an API call per class; it can only be run after the
  fact, so nothing is corroborated live; and whether the necessary endpoint is available on a free
  account has not been verified.

**This has not been built and is not recommended yet.** It is written down so the decision is a
choice between two known options rather than a dead end.

---

## What is stored, and what is deliberately not

Stored: which provider said it, the provider's event id and type, when it happened and which of
its clocks that came from, the class, the room name, meeting and participant ids, whether the
provider thought somebody was a moderator, and a duration. For connection reports: one of four
words (`good`, `warning`, `bad`, `unknown`), a reconnect flag, and a time.

**Not stored, and asserted by tests:** raw payloads, signatures, tokens, participant names, IP
addresses, device identifiers, anything about audio or video, jitter, packet counts, bitrates or
ICE candidates.

Storing a provider's whole callback "in case it is useful later" builds a behavioural archive of
every teacher and student that nobody chose and nobody reviews.

---

## Retention: written, tested, and not running

> **Activation block (2026-09-05):** the insert-versus-sweep race is now closed in code and has a
> real-Postgres race test, but retention remains deliberately unscheduled. It must not run against
> real evidence until the provider contract has been verified with a real Daily delivery and the
> complete proof and retention suites pass against the target database.

Fine-grained rows are meant to live **thirty fixed days** — days rather than a calendar month,
because Bikram Sambat months run 29–32 days and Gregorian 28–31, so calendar arithmetic gives one
policy two answers.

`lib/sessionProof/retentionSweep.ts` implements it with one short transaction per class: it takes
the class's exclusive transaction-scoped advisory lock before reading, locks every row, writes a
durable per-class summary, and only then deletes exactly those rows. Both attached provider-event
inserts and authenticated quality-sample inserts take the shared form of that same two-key lock in
their insert transaction. A writer that wins commits before retention reads; a writer that loses
waits and leaves its row fully available after retention commits. Unattached provider events do
not belong to a class and remain independent. Counts and spans survive; individual timestamps do
not, because after the dispute window "the teacher's device reported three bad periods" is a fact
about a lesson and "at 19:42:11 this person's connection was bad" is surveillance.

Three rules in it are worth knowing, because each replaces a way of silently corrupting the
record:

- **A class moves all at once, or not at all.** An earlier version swept row by row, so a meeting
  that started at 10:00 and ended at 11:00 had its two rows expire an hour apart: one pass took
  the start and wrote "one meeting, no length", the next took the end and added another. The
  lesson ended up permanently recorded as two meetings of no length, with the rows gone and no way
  to correct it. Now every row a class has must be past the window or none of them moves.
- **Age is counted from when we received a row, not from when the event says it happened.** A
  webhook delivered a week late carries a timestamp a week old; measuring from that would delete
  it after twenty-three days of actually holding it.
- **A source nobody was watching contributes nothing — not a zero.** Its columns stay empty, it is
  named as unknown, and if evidence turns up later the empty column is filled in honestly. A
  figure that arrives after a class was already summarised is counted as a late arrival rather
  than added, because a lone late "meeting ended" would otherwise become a second meeting of no
  length by another route.

**Nothing calls it.** It is not scheduled, not called at boot, not on any route, and no module
imports it; `test:retention` asserts all of that. It can only be run by hand.

Switching it on is a separate decision, and it must not happen before ingestion has been proven
against a real delivery — deleting rows nobody ever verified is deleting the chance to find out
they were wrong.

---

## Why this is not, and must not become, an automatic refund judge

1. **The corroborating source has never run against real traffic.** A parser that silently rejects
   everything looks exactly like a provider that saw nothing.
2. **Absence is ambiguous.** A missing event could be a class that never happened, a delivery that
   failed, an unregistered webhook, or a table that does not exist. The summary distinguishes these
   for a *reader*; no rule can safely collapse them.
3. **Connection reports are self-reported by an interested party**, and a device that never
   reported is not a device that had no trouble.
4. **Sources will disagree**, and that disagreement is the thing worth reading.
5. **The policy forbids it.** REFUNDS.md section 3: rules over evidence produce a recommendation
   and *a person decides*. This stops one step earlier still — it produces no recommendation at
   all, and a test asserts that the words refund, recommend, verdict, at fault and entitled appear
   nowhere in an evidence summary.

---

## Running the suites

Both need a Postgres to point at. Neither touches production.

```
PGURL=postgres://... pnpm --filter @workspace/api-server run test:proof       # 107 checks
PGURL=postgres://... pnpm --filter @workspace/api-server run test:retention   #  73 checks
```

`test:proof` starts its own servers, so `pnpm --filter @workspace/api-server run build` must have
run first. Both are re-runnable against the same database — every assertion is scoped to its own
run, because a suite that asserts absolute row counts passes once and fails forever after.

---

## Before any of this is switched on

1. ~~Confirm Daily's signing algorithm and published event fields.~~ Confirmed from Daily's
   official documentation on 2026-09-05.
2. Find out whether the account can register a webhook without a paid plan. **Do not add a card
   to answer this** — ask, or read the documentation.
3. If it does, decide between leaving this off and building the REST reconciliation above.
4. Register the webhook, capture one real delivery, and confirm it verifies and correlates.
5. Compare that genuine delivery with the published shapes before narrowing the parser further.
6. Only then consider wiring the app to report connection quality, and only after that consider
   scheduling retention.
7. Before enabling provider ingestion, verify in each target database that
   `session_provider_events_participant_dedupe_idx` is a partial **UNIQUE** index with the expected
   columns and predicate. `CREATE UNIQUE INDEX IF NOT EXISTS` does not repair a wrong non-unique
   index that already has the same name. Bootstrap now inspects the actual catalogue definition
   after its create statements and provider ingestion fails closed with a generic 503 unless the
   definition is exact. It intentionally does not drop an index or delete/deduplicate data at boot.
8. Re-run the real-Postgres insert-versus-sweep race in `test:retention` before scheduling it in
   any environment. The code remains uncalled and unscheduled.
