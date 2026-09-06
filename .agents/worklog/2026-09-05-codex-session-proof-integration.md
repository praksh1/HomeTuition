# Codex integration review — session proof

Date: 2026-09-05
Branch: `codex/session-proof-integration`

## Combined

- Merged Claude's provider-corroboration scaffolding at `6559679` with Codex's deterministic,
  human-readable operator narrative at `67709da`.
- Preserved both additive API fields: `caseNarrative` explains the stored business record in plain
  language; `proof` distinguishes Sikshya's attendance ledger, provider callbacks, and self-reported
  device quality.
- Preserved both operator UI sections. Neither produces a verdict or changes a refund.
- Bounded each retention candidate query with database-side ordering and `LIMIT`; the previous code
  loaded every expired session id into application memory and only then sliced it.

## Independent verification

- Checked out Claude's final branch independently and ran the API unit suite, proof suite,
  retention suite, app unit suite, root typecheck command, and `git diff --check`.
- Unit/integration suites passed. The root typecheck command completed on that branch.
- On the combined branch, focused package typechecks remain blocked by pre-existing unavailable
  packages: API `jose`; app `expo-apple-authentication` and Expo social-auth provider modules. This
  was present before this integration and is unrelated to session proof.

## Problems found (not hidden)

1. The schema bootstrap explains that a same-name non-unique index can defeat `CREATE UNIQUE INDEX
   IF NOT EXISTS`, but it does not verify or repair that state. No deployment is known to contain
   the wrong index. Provider ingestion must stay disabled until the target database index is
   verified or the bootstrap gets a safe invariant check.
2. Retention candidate selection claimed to be bounded but was bounded only after all ids reached
   Node. The integration branch now applies deterministic SQL limits.
3. Retention's `FOR UPDATE` locks existing rows, not a concurrent row that has not been inserted
   yet. An ingest-versus-sweep race therefore violates the stated whole-session roll-up guarantee.
   Retention is still imported by no production module and scheduled nowhere. It must remain that
   way until ingestion and sweeping share a session-scoped advisory lock and a real concurrency
   test passes.

## Deliberately not done

- No Daily dashboard change, webhook registration, secret creation, or plan/card action.
- No production or staging database command; no `db:push`.
- No retention scheduling or production evidence collection.
- No refund automation, payment change, membership change, classroom socket change, or Daily
  replacement.
- No deployment from this integration branch yet.

## Next safe task

The session-proof safety follow-up was implemented locally, and remains uncommitted for review:

- Added one documented two-key PostgreSQL advisory-lock protocol. Attached provider writes and
  authenticated quality writes take its shared transaction lock; retention takes the exclusive
  form before reading a class.
- Changed retention from one transaction spanning up to 200 sessions to one short transaction per
  session. Aggregate-before-delete ordering, all-or-nothing eligibility, dry-run behavior, and the
  independent unattached-event cleanup remain intact.
- Added a real-Postgres race harness. It pauses a writer after its insert while holding the shared
  lock, starts retention, then proves retention waits, sees the committed recent row, holds the
  complete class, and later aggregates the participant join normally with zero `late_arrivals`.
- Added a fail-closed catalogue invariant. Bootstrap inspects uniqueness, exact ordered columns,
  and the exact partial predicate behind the participant dedupe index. Provider ingestion returns
  only a generic 503 while unchecked/invalid. Classroom routes do not read this state.
- Added pure definition tests and a Postgres fixture that replaces the test database index with a
  deceptive same-name plain index, verifies evidence is refused, and restores the exact UNIQUE
  partial index in `finally`. Boot never drops an index or rewrites/deduplicates evidence.

### Verification in this Windows workspace

- `pnpm --filter @workspace/api-server run test`: **414 passed, 1 failed**. The only failure is the
  pre-existing missing `jose` package in `socialIdentity.test.ts`; all session-proof/retention unit
  tests passed.
- Focused session-proof unit suite: **95 passed, 0 failed**.
- Sikshya app unit suite: **215 passed, 0 failed**.
- Design ratchet: **pass**, no new leaks (204 hex literals / 418 raw sizes, baseline unchanged).
- Root `pnpm run typecheck`: exited successfully after the shared-library build, but pnpm reported
  that no artifact projects matched its filters; this is not evidence that the API/app typechecks
  passed.
- `pnpm --filter @workspace/api-server run typecheck`: blocked only by the same pre-existing
  missing `jose` import in `socialIdentity.ts`.
- API build: could not complete in the managed filesystem sandbox because esbuild could not read
  dependency paths outside the workspace; it also reported the known unavailable logging worker
  dependencies.
- `git diff --check`: clean apart from Git's Windows LF-to-CRLF notices.
- `test:proof`: the test server never became healthy, consistent with the unavailable built API
  runtime above; it stopped before the deceptive-index fixture.
- `test:retention`: esbuild was denied access outside the managed workspace and could not resolve
  the sweep harness import. Therefore the new destructive test fixture and real concurrency race
  have been authored but **not claimed as passed in this workspace**.

Codex then retried both database suites with the ordinary workspace restrictions lifted. The
proof server still did not become healthy, and the retention harness stopped before touching a
database because the `psql` executable is not installed or available on this Windows PATH
(`spawnSync psql ENOENT`). These are environment blockers, not passing results; the new catalogue
fixture and race remain unexecuted here.

### Deliberate guard break

The pure invariant guard was deliberately weakened to accept any present `is_unique` value. Its
same-name plain-index test immediately turned red (**3 pass, 1 fail**); restoring the strict
boolean check returned the focused file to **4 pass, 0 fail**. The real lock call could not be
deliberately removed and meaningfully exercised here because the Postgres harness is blocked
before it runs; no false red/green claim is made for that guard.

### Still deliberately not done

No branch switch, commit, push, deployment, `db:push`, production/staging database command,
retention schedule, Daily dashboard change, purchase, refund automation, or change to payment,
membership, classroom, socket, or live-call behavior.

### Next safe task

Run both Postgres suites in an isolated test database, review the uncommitted diff, and only then
consider committing this disabled evidence scaffolding. Real provider activation still requires a
captured Daily delivery and contract verification.

---

## Operator account integration — one narrative instead of two

### Requested

Fold the already-computed `SessionProofSummary` into the deterministic operator case narrative for
one unique session. Explain provider meetings, named-person source agreement or conflict, and coarse
device quality without re-querying, exposing diagnostics, inventing zeroes or making a decision.
Reduce the duplicate operator presentation. Leave all evidence collection and live behavior alone.

### Changed

- `sessionCaseNarrative.ts` now accepts the already-computed proof summary from the route. It does
  not import a database reader or query any source.
- The readable summary names availability for the classroom ledger, independent video-provider
  record and participant-device reports.
- Every provider meeting is described separately with its own start, end and measured span. A
  missing endpoint stays unavailable, and multiple meetings are never merged across a gap.
- Teacher, reporter and any other person whose sources conflict receive a named, plain-language
  comparison. Agreement is explicitly agreement about presence only. Conflict explicitly says the
  record does not establish its cause.
- Coarse good/warning/bad/unknown device buckets and reconnect counts are shown only when reported,
  and are labelled as coming from the participant's own device. Missing reports are not rendered as
  a zero or as a good connection.
- Provider and device timeline events are translated into names and source labels. Provider meeting
  ids, numeric user references embedded in technical text, raw diagnostics and provider event prose
  are not copied into the narrative.
- Timeline ordering now has a deterministic tie-break after timestamp and continues to render in
  Nepal time.
- The operator UI's parallel “What each source saw” block was removed. Its facts and cautions now
  appear inside the single case summary and the single source-labelled timeline. Existing attendance
  rows and factual findings remain visible underneath as the inspectable source record.
- `sourceNotes` is optional in the app response type so an older API cannot crash a newer web build
  during a staggered deployment.

### Focused tests added

- Named socket/provider agreement, with the scope limited to presence.
- Named-source disagreement with no guessed cause.
- Unavailable provider and device sources never becoming zero observations.
- A provider-only observation while the classroom ledger is unavailable remaining single-source,
  rather than being mislabeled as a conflict with a readable ledger.
- Two provider meeting instances remaining separate, including one with an unavailable end.
- Deterministic Nepal-time meeting wording.
- Coarse self-reported quality and reconnect evidence without raw diagnostics.
- Provider timeline sanitisation: person names survive, internal meeting and numeric user ids do not.
- A combined account contains none of the decision phrases `refund`, `recommend`, `verdict`,
  `should be`, `at fault` or `entitled` in the ordinary paid-booking fixture.

### Verification actually run

- Focused narrative suite: **18 passed, 0 failed**.
- API unit suite: **420 passed, 1 failed**. The only failure is the pre-existing local inability to
  resolve `jose` in `socialIdentity.test.ts`; all narrative and session-proof tests passed.
- Sikshya app unit suite: **215 passed, 0 failed**.
- Design ratchet: **pass**, 204 hex / 418 raw sizes, baseline unchanged.
- API typecheck: blocked only by the same pre-existing missing `jose` module.
- App typecheck: blocked only by the pre-existing missing `expo-apple-authentication` and Expo
  Facebook/Google auth-session provider modules.
- `git diff --check`: clean except Windows LF-to-CRLF notices.

### Failures and corrections during this slice

- The first focused run was **15 passed, 2 failed**. One old test still expected the superseded
  “strong, moderate or weak” unavailable sentence; it was updated to the new source-unavailable
  statement. One new no-diagnostics regex matched the letters `ip` inside “participant”; it was
  narrowed to the whole word `IP`. The rerun passed all 17; the later unavailable-ledger case
  brought the final focused suite to 18.
- No browser or device rendering was run. Removing roughly 150 lines of duplicate proof UI reduces
  the phone-length page, but visual scannability is not claimed until an operator ticket with proof
  data is rendered.

### Deliberately not done

- No schema or state change, `db:push`, Postgres command, retention run or schedule.
- No payment, refund, membership, socket, classroom, Daily room or provider configuration change.
- No telemetry sender, webhook activation, Daily dashboard action, recording or purchase.
- No commit, push, merge or deployment. The edits remain in the working tree for lead review.

### Next pickup

Review the uncommitted diff and render a session-linked operator ticket at phone and laptop widths.
The underlying provider/telemetry sources remain disabled; a real Daily callback still has to be
verified before activation.

---

## Independent verification on real PostgreSQL — claude, 2026-09-06

- Branch: `codex/session-proof-integration`, checked out at `d1bb737` with a clean working tree.
- Database: a **local container PostgreSQL only** — `postgres://postgres@127.0.0.1:55432/sikshya`,
  started by hand from `/var/lib/postgresql/testdata`. No Railway, no Neon, no staging, no saved
  production URL, and **no `db:push` anywhere**. The repository `.env` points at that same local
  cluster and nothing else.

### The two suites Codex could not run, run

Both had been authored but never executed; both found a real defect on first contact with a
database. That is the whole value of the exercise, so the failures are recorded before the passes.

**`test:proof` failed wholesale — 26 checks red, every provider write refused with
`503 Evidence storage is temporarily unavailable`.** The new fail-closed catalogue invariant was
rejecting a database whose index was perfectly correct.

Root cause, confirmed by probing the driver rather than by reading: `pg_attribute.attname` has
PostgreSQL type `name`, and node-postgres registers no array parser for `name[]`. The catalogue
query's `ARRAY(SELECT a.attname ...)` therefore came back as the **raw literal string**
`"{provider,event_type,provider_participant_id}"`, not a JS array. `Array.isArray` on that is
false, so `providerDedupeIndexIsValid` judged a healthy index invalid and ingestion failed closed
forever. Fixed by casting each element to `text` in the query — one cast — so the column is
`text[]`, which the driver does parse. The guard itself was not touched: failing closed on a shape
it does not recognise is the right instinct and it stays.

**`test:retention` then failed one check** — "after its full retention window the raced-in row is
aggregated as evidence". A fixture bug, not a code bug: the race harness inserted an *anonymous*
`participant.joined`, while `summariseExpiring` deliberately counts a join toward
`provider_participant_join_events` only when the provider could name the account. Counting
anonymous joins would be the fabrication that rule exists to prevent, and it has its own pure test.
Fixed by giving the racing writer the identity a real ingest would have resolved against
membership, which makes the race prove the *stronger* fact: the raced-in row survives as named
evidence. The assertion was not weakened.

### Results

| Gate | Result |
|---|---|
| `pnpm run typecheck` (4 packages) | **clean** |
| `pnpm --filter @workspace/api-server run test` | **424 passed, 0 failed** |
| `pnpm --filter @workspace/sikshya run test` | **215 passed, 0 failed** |
| `pnpm --filter @workspace/api-server run test:proof` | **125 passed, 0 failed** |
| `pnpm --filter @workspace/api-server run test:retention` | **79 passed, 0 failed** |
| `pnpm --filter @workspace/api-server run test:attendance` | 74 passed, 0 failed |
| `pnpm --filter @workspace/api-server run test:refunds` | 152 passed, 0 failed |
| `pnpm --filter @workspace/api-server run test:video` | 16 passed, 0 failed |
| `pnpm --filter @workspace/sikshya run lint:design` | no new leaks; 204 hex / 418 sizes |
| `git diff --check` | clean |

Both database suites were run repeatedly against the same database to prove they are re-runnable.

### The dependency question, answered

`jose`, `expo-apple-authentication` and `expo-auth-session` are **declared in `package.json` and
present in `node_modules`** here, and all four packages typecheck cleanly with no changes. The
Windows failures were an incomplete install, not a package or lockfile problem. **Nothing was
changed**, so no hidden social-login UI is exposed and no sign-in provider was activated. The fix
on that machine is `pnpm install`, not a dependency edit.

### Deliberate breaks — each proven red, then restored

| # | Guarantee | Guard removed | Result |
|---|---|---|---|
| 1a | deceptive same-name index fails ingestion closed | the invariant requiring the index to be UNIQUE | proof 111 / **3 fail** |
| 1b | …without repairing evidence automatically | boot's refusal to drop and recreate the index | proof 110 / **4 fail** |
| 1c | the catalogue read survives the driver boundary | the `::text` cast on `attname` | proof 63 / **51 fail** |
| 2a | ingest racing retention is never partly summarised | the writer's shared advisory lock | retention 74 / **5 fail** |
| 2b | ingest racing retention is never partly summarised | retention's exclusive advisory lock | retention 74 / **5 fail** |

All five went red; every file was restored immediately and the suites returned to green.

### Assertions added, because two guarantees were only half covered

- **The deceptive-index fixture proved the 503 but not the "without repairing" half.** It now
  captures the row count and the index's uniqueness before the server boots and asserts both are
  unchanged afterwards — a bootstrap that recreated the index as UNIQUE would have to delete the
  duplicate rows accumulated under the plain one, which is a destructive repair of evidence decided
  by a process nobody watched. Break 1b exists to prove this assertion works.
- **Every Nepal-time test compared the narrative with itself**, which proves repeatability and says
  nothing about correctness. A formatter quietly rendering UTC would misdate every piece of
  evidence by 5h45m and look perfectly consistent. Added a test pinning 04:15 UTC to 10:00
  Kathmandu, asserted on the digits so it does not depend on ICU wording.
- **The narrative audit ran only against unit fixtures.** The operator screen no longer renders the
  technical proof block at all, so the narrative *is* what a person reads. `test:proof` now audits
  the real `caseNarrative` returned by `GET /admin/tickets/:id` for a class that has genuine stored
  provider rows: no meeting id, no participant connection id, no provider event id, no room name,
  no `user <n>` reference, no decision phrase, at least one "unavailable", and Nepal-time rendering.

### Narrative audit — findings

| Requirement | Verdict |
|---|---|
| Uses the already-computed proof object, no second query | **Pass.** One import, type-only; zero database references in the file; `admin.ts` passes the `proof` built from the same reads |
| Provider meetings stay separate | **Pass.** One `provider_meeting_N` line each, own start/end/span; multi-meeting text says time between them is not measured meeting time |
| Missing sources say "unavailable", never zero | **Pass.** Every branch, including "not evidence of a good connection" and "not proof that the class did not occur" |
| No provider ids, diagnostics, secrets, tokens or internal numeric ids in prose | **Pass.** The timeline is rewritten from the entry *code*, never copying provider text; people are named, never numbered; verified end to end against real rows |
| Never decides fault, recommends a refund, or claims settlement | **Pass.** Verified end to end. Settlement is mentioned only in denials, which the new check enforces sentence by sentence rather than by banning the word |
| Nepal-time wording deterministic | **Pass, with a caveat.** Timezone and offset are pinned and now tested. The *wording* comes from `Intl` with locale `en-NP`, so an ICU upgrade could change "Sep" to "Sept". Cosmetic, not an evidence risk; not changed, because the format is a presentation decision |

One deliberate judgement: the narrative header shows `Session #<id>`. That is the class's own
business reference — the key an operator navigates by, like the ticket number beside it — not a
provider identifier or a user id, so it stays.

### Classroom changes reviewed

`classroomHub.ts` moves `ledger.messages += 1` inside the `if (text)` guard and `ledger.draws += 1`
inside the `if (deliverable.length > 0)` guard. Both counters feed only `session_participation`;
neither is read by any behavioural path, and the broadcast conditions are unchanged. So blank chat
frames and stale scene replays stop inflating the evidence ledger, and nothing about the classroom,
the whiteboard, presence or the call changed. `test:attendance` covers both and passes.

### Environmental notes

- The container restarted mid-session; PostgreSQL and the API on 8080 were lost and restarted by
  hand. The working tree survived. `test:attendance` and `test:refunds` need a server on 8080 that
  they do not start themselves, and their failure without one looks like a code failure.
- I twice put backticks inside a JavaScript template literal while writing a comment, which
  terminated the string and broke the build and then the retention harness. Both were caught by the
  build and the suite; recorded because the error message points nowhere near the cause.

### What remains unverified

1. **No real webhook has ever been received.** Every test posts a locally-signed body.
2. **Whether the current account can register a webhook without paid activation.** Daily's REST
   reference labels webhook management Pay-as-you-go but does not explicitly answer the card
   question. Nothing was bought.
3. **No browser or device rendering.** The operator ticket has not been seen at phone or laptop
   width since roughly 150 lines of duplicate proof UI were removed. Automated checks pass;
   scannability is not claimed.
4. **Retention has still never run anywhere but a test database**, and remains imported by no
   production module.

### Codex follow-up: official Daily contract verified — 2026-09-05

Codex reached Daily's current official REST documentation from a separate environment and checked
the contract without signing in, registering a webhook, adding a card or changing the account.

- <https://docs.daily.co/reference/rest-api/webhooks> confirms the Base64-decoded secret,
  timestamp-dot-JSON HMAC-SHA256 input, Base64 signature, named headers, activation probe, possible
  duplicate/out-of-order delivery, and top-level event id as the idempotency key.
- The published `participant.joined`/`participant.left` schemas confirm `session_id`, `user_id`,
  `room`, timestamps and the left-event duration.
- The published `meeting.started`/`meeting.ended` schemas confirm `meeting_id`, with `start_ts` and
  `end_ts` on the ended event.

Result: the static signing and field-name contract is no longer an unknown. Real deployed delivery,
account eligibility and end-to-end correlation remain unverified, so ingestion stays disabled.

### Confirmation

No deployment. No merge. No production or staging database contact. No `db:push`. No Daily
dashboard action, webhook registration, secret, key, account, card or purchase. No retention
schedule or production collection enabled. No change to payments, refunds, membership, classroom
sockets, whiteboards or Daily call behaviour. The only database touched was the local container
cluster on port 55432.

---

## Rendered verification of the operator ticket — claude, 2026-09-06

The one claim in this work that no test could back. Codex's own note said so: "No browser or device
rendering was run… visual scannability is not claimed until an operator ticket with proof data is
rendered." This is that rendering.

- Branch `codex/session-proof-integration` at `0e6da21`, clean tree at start.
- Local container PostgreSQL only (`127.0.0.1:55432/sikshya`), local API on 8080, the static web
  build served on 8090. No shared database, no `db:push`, no external service.
- Headless Chromium at two viewport sizes. **A browser is not a phone** — this is evidence about
  layout, and none of it is evidence about iOS or Android hardware.

### The fixture

Ticket `HT-000075` on session 733, built to be worth looking at rather than merely to load: a
completed class, a teacher, a paying student who attended, a second student who paid and never
appeared, an attendance ledger that disagrees with the provider about the reporter, four thread
messages, a schedule change, **two separate provider meetings** (the second with no recorded end),
named and anonymous participant events, four coarse device reports for the teacher and **none for
the student** — so "unavailable, not zero" had something real to render. The result is 17 summary
lines, 21 timeline entries, 4 unavailable statements and 3 source cautions: 7,518 px of content on
a phone.

### What was found

**One genuine defect, and it was material.** Every timestamp outside the case narrative — the
reporter line, "The class", every message, the reporter's activity and the ticket history — was
rendered with a bare `toLocaleString()`: the *viewer's* timezone, with no label. The narrative
beside them renders Nepal time and says so. On this container the class therefore appeared as
"9/5/2026, 4:15:00 AM" directly above "Sep 5, 2026, 10:00 AM Nepal time" **for the same lesson**.
An agent deciding a refund would have seen one class at two times with no way to tell which was
real — and an agent working from a laptop set to any other timezone would have seen it silently,
with no clue anything was wrong.

Fixed with one `nepalTime()` helper in that screen, used for all six timestamps, matching the
options the server's own narrative formatter uses so the page reads as one document rather than
two systems. UI only: no evidence calculation, query, schema, payment, refund, membership, socket,
Daily or classroom behaviour touched.

### Everything else, measured rather than eyeballed

| Check | phone 390×844 | laptop 1440×900 |
|---|---|---|
| One "Session summary", no competing block | pass | pass |
| Horizontal scroll | none | none |
| Elements overflowing the viewport | none | none |
| Text clipped by a fixed-height box | none | none |
| Text below 11 px | none | none |
| Console or page errors | none | none |
| Scrolling reaches the end | 7,518 px over an 844 px window, 8 captures | 5,007 px over 900 px, 6 captures |
| Provider meetings separate | pass — "Provider meeting 1" and "Provider meeting 2", the second's length unavailable | pass |
| Nepal-time labels | 42 labelled instants, one format | same |
| Unavailable evidence and cautions visually distinct | pass — amber panel, amber headings, separated from the neutral summary | pass |
| Attendance, findings, messages, timeline reachable | pass | pass |
| No provider meeting id, connection id, event id or room name | pass | pass |
| No internal numeric user reference | pass | pass |
| No wording deciding fault or promising a refund | pass | pass |

The touch-target scan reported entries at both widths, but every one is an inner `<Text>` inheriting
`cursor: pointer` from a larger pressable — "Save note" at 67×17 sits inside a 215×43 button. The
real controls meet size on the laptop. On the phone the "Save note" button measures **44×34**,
which is under the 44 px height guideline; it is reachable and works, and is recorded here as a
follow-up rather than changed, because it belongs to the ticket action bar rather than to this
evidence work.

### Not fixed, deliberately, and why

- **The summary is 17 similar-weight bullets with no grouping.** It is readable; it is not
  especially *scannable*. Grouping it (booking / what happened in the room / what each source saw)
  is a design decision about the narrative's own `code` values, not a defect, so it is Codex's or
  the owner's call rather than mine.
- **At 1440 px the summary lines run the full card width**, about 180 characters — well past a
  comfortable measure. Capping it needs a reading-width convention that does not exist in this app
  yet, and inventing one on a single screen would make it the odd page out.
- **"0 students had a paid or operator-granted test place before the scheduled start"** is correct
  for this fixture and reads oddly: both students booked *after* the class date was backdated, so
  the sentence is literally true. Worth knowing when reading these screenshots; not a product bug.

### Screenshots

`/tmp/claude-0/-home-user-HomeTuition/dfaf26b1-4dec-5cf0-9e29-e2224fdc575f/scratchpad/shots/`

- `phone-390x844-01.png` … `-08.png` — the whole page at 390×844, scrolled
- `laptop-1440x900-01.png` … `-06.png` — the whole page at 1440×900, scrolled
- `phone-390x844.txt`, `laptop-1440x900.txt` — the rendered text of each

Temporary scratch, outside the repository and not committed. They do not survive this container.

### Gates

| Gate | Result |
|---|---|
| `pnpm run typecheck` (4 packages) | clean |
| `pnpm --filter @workspace/api-server run test` | **424 passed, 0 failed** |
| `pnpm --filter @workspace/sikshya run test` | **215 passed, 0 failed** |
| focused `sessionCaseNarrative.test.ts` | **19 passed, 0 failed** |
| `pnpm --filter @workspace/api-server run test:proof` | 125 passed, 0 failed |
| `pnpm --filter @workspace/api-server run test:retention` | 79 passed, 0 failed |
| `pnpm --filter @workspace/sikshya run lint:design` | no new leaks; 204 hex / 418 sizes |
| `git diff --check` | clean |

### Not verified

Real hardware. This is Chromium at two window sizes: it says nothing about a cheap Android phone's
paint speed, touch behaviour, or how this page feels on a poor connection — which is the audience
this project is built for. It also says nothing about the Daily contract, which remains unread from
the source because `docs.daily.co` is blocked here.

### Confirmation

No deployment, merge, `db:push`, shared-database command, Daily webhook registration, retention
schedule, external-service change or purchase. The only writes were synthetic rows in the local
test database.

---

## Grouping, reading width and touch targets — claude, 2026-09-06

Codex's four decisions after the visual report, implemented as a UI-only refinement. Verified by
rendering the same synthetic ticket (`HT-000075`, session 733) again at both widths.

### Changed

- **`artifacts/sikshya/utils/sessionSummaryGroups.ts`** (new) — sorts the summary into "Booking and
  schedule", "What happened in the classroom" and "What the evidence sources recorded" **on the
  stable `code`, never on the English**. Categorising on the sentence would break the first time
  somebody rewords a line, and would move a fact into the wrong group rather than failing — which
  on an evidence page is the worst kind of bug, because the sentence still looks right where it
  lands. Numbered codes (`provider_meeting_2`, `participant_source_account_1`, `device_quality_3`)
  match by prefix, so a class with nine meetings does not scatter.
- **`sessionSummaryGroups.test.ts`** (new, 9 tests) — including the fallback the brief asked for:
  an unrecognised code lands in "Other recorded facts" and stays visible. An older web build must
  cost a heading, never a fact. Also asserts every line survives exactly once, the server's order
  inside a group is untouched, empty groups are dropped rather than shown as a heading over
  nothing, and no code belongs to two groups.
- **`constants/layout.ts`** — added a `readingWidth` token (680). It lives in the design system
  rather than in one screen because "a value in a screen is a *choice from a list* rather than a
  number somebody typed" is what that file exists for, and the second screen that needs it must get
  the same answer.
- **`app/(admin)/ticket/[id].tsx`** — the three groups rendered under `accessibilityRole="header"`
  headings; `maxWidth: readingWidth` with `width: "100%"` and `alignSelf: "center"` on the scroll
  content; `minHeight: HIT_SLOP_MIN` plus `justifyContent: "center"` on the shared action style and
  on the internal-note row. `HIT_SLOP_MIN` already existed at 44 — used rather than a fresh literal.

Nothing server-side was touched: no narrative calculation, no evidence meaning, no ordering, no
query, no schema.

### Measured, at 390×844 and 1440×900

| Check | phone | laptop |
|---|---|---|
| Group headings, each exactly once | pass | pass |
| Every server fact in the summary panel | **17 present, 0 missing, 0 duplicated** | same |
| Stray "Other recorded facts" | none | none |
| Widest column of running text | 324 px | **582 px** (was the full 1408 px) |
| Horizontal scroll | none | none |
| Elements overflowing the viewport | none | none |
| Clipped text | none | none |
| Text below 11 px | none | none |
| Console or page errors | none | none |
| Scrolling reaches the end | 7,591 px over 844 px, 8 captures | 6,381 px over 900 px, 8 captures |
| `admin-note` ("Save note") | **46×77** (was 44×34) | **89×60** |
| Every `admin-move-*` status button | 46×77 | 89×60 |
| "Grant a full refund" | 324×59 | 582×59 |
| Internal-note toggle | 324×44 (was ~17) | 582×44 |
| Overlap between adjacent action controls | none | none |
| Provider meetings separate, Nepal-time labels, cautions distinct | pass | pass |
| No provider/connection/event id, room name or `user <n>` | pass | pass |
| No wording deciding fault or promising money | pass | pass |

The amber "What this record cannot confirm yet" / "Source cautions" panel now closes the evidence
group rather than floating after everything, which is where it belongs and where it stays visually
distinct.

### Two things worth knowing

**My own retention suite ate the fixture.** `test:retention` runs sweeps with `nowMs` set 31 days
into the future, and a sweep processes *every* candidate class in the database, not only the ones
that suite created. Running it deleted session 733's provider events and quality samples, and the
first re-render silently lost the provider meetings and the whole timeline. Not a product defect —
the sweep behaved exactly as designed — but a real trap for anyone sharing one test database
between the suites and a rendering fixture. Re-seeded and re-rendered.

**A "duplicated fact" that was not one.** The first pass flagged `reporter_booking` as appearing
twice. It appears once in the summary and once in the chronological timeline, which is the
narrative's own design. The check was measuring the whole page; it now scopes to the summary panel,
which is what "no line was dropped or duplicated by grouping" actually means.

### Gates

| Gate | Result |
|---|---|
| focused `sessionCaseNarrative.test.ts` | **19 passed, 0 failed** |
| focused `sessionSummaryGroups.test.ts` | **9 passed, 0 failed** |
| `pnpm --filter @workspace/api-server run test` | **424 passed, 0 failed** |
| `pnpm --filter @workspace/sikshya run test` | **224 passed, 0 failed** (was 215) |
| `pnpm run typecheck` (4 packages) | clean |
| `pnpm --filter @workspace/sikshya run lint:design` | no new leaks; 204 hex / 418 sizes |
| `git diff --check` | clean |

### Screenshots

`/tmp/claude-0/-home-user-HomeTuition/dfaf26b1-4dec-5cf0-9e29-e2224fdc575f/scratchpad/shots/` —
`phone-390x844-01.png` … `-08.png`, `laptop-1440x900-01.png` … `-08.png`, plus the rendered text of
each. Temporary scratch, outside the repository, not committed, and gone when this container is.

### Not verified

Real hardware, again: this is headless Chromium at two window sizes and says nothing about a cheap
Android phone's paint speed or touch behaviour. No new packages, animations or heavy components
were added, so the performance profile should be unchanged — but "should be" is not a measurement.
Daily ingestion remains disabled; nothing was registered, enabled or bought.

---

## Isolated staging preview deployment — Codex, 2026-09-05

### Result

- Merged reviewed `codex/session-proof-integration` through `446feb7` into
  `codex/staging-preview-integration` as merge commit `ec1453d`.
- Pushed `ec1453d` to the integration branch. Railway did not deploy it because the isolated
  staging service still watches `claude/excalidraw-whiteboard-sync-gjoqaz`, as the existing preview
  documentation records.
- Proved the watched branch was an ancestor and fast-forwarded only that branch from `bc0aa17` to
  `ec1453d`. `main` and the production Worker were untouched.
- Railway staging finished deploying when `POST /api/sessions/1/quality` changed from HTTP 404 to
  HTTP 401. The latter is the expected unauthenticated response from the new protected route.
- Built the Expo web export with `EXPO_NO_DOTENV=1` and the explicit isolated API
  `https://hometuition-api-staging-production.up.railway.app`.
- Scanned the generated files: one or more startup files contain the staging host; zero contain
  the known production API host.
- Wrangler 4.124.0 dry-run accepted 242 assets with no bindings.
- Deployed only Worker `hometuition-preview`, version
  `d353d6b1-6c2d-48a2-89b7-8e6337c9c59b`.
- Live URL: <https://hometuition-preview.praksh-dhakal.workers.dev>
- Post-deploy verifier matched the served HTML and all three initial bundles byte-for-byte against
  the tested local build, confirmed the staging API and rejected the production API. `/welcome`
  returned HTTP 200.

### Verification

- API unit tests: 424 passed, 0 failed.
- Sikshya unit tests: 224 passed, 0 failed.
- API, Sikshya and scripts typechecks: passed.
- Design ratchet: 204 hex / 418 raw font sizes, unchanged; no new leaks.
- Preview verifier unit tests: 7 passed, 0 failed.
- `git diff --check`: clean before deployment.

### What went wrong, and why it was not hidden

1. The first named typecheck/test run inside the restricted filesystem sandbox reported `jose`
   and Expo social-auth modules missing even though the lockfile and package junctions existed.
   `pnpm install --frozen-lockfile` correctly reported no dependency change. Rerunning outside the
   restricted sandbox allowed Node to follow the existing pnpm junctions; every typecheck passed
   and API tests passed 424/424. No package or lockfile was changed.
2. Pushing only `codex/staging-preview-integration` produced no Railway deployment. Eight probes
   stayed HTTP 404. The service's documented watched branch was then fast-forwarded; the twelfth
   subsequent probe returned the expected HTTP 401. This is branch routing, not an application
   defect.
3. Expo rebuilt a cold Metro cache and emitted its existing unsupported-local-CSS warning for
   Excalidraw. The export completed successfully and the remote verifier matched it exactly.

### Deliberately not done

- No production deploy, `main` merge, payment, card, purchase, Daily webhook registration,
  `DAILY_WEBHOOK_SECRET`, retention schedule, real recording or real provider call.
- No `db:push`. The API's existing create-only, failure-isolated bootstrap created additive proof
  tables on staging when needed.
- No claim of real Daily behaviour: staging remains `VIDEO_PROVIDER=echo` by design.
- No real-user data was copied into staging and no production credential was added.

### Owner review boundary

This deployment is suitable for reviewing the operator evidence layout and the existing synthetic
teacher/student journeys. Provider corroboration will honestly appear unavailable because Daily
ingestion is disabled. It does not prove a real two-device Daily call or cheap-Android behaviour.
