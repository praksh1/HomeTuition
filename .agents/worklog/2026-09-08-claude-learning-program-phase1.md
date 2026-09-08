# Learning Programs — Phase 1 schema and read API

- Date: 2026-09-08
- Agent: claude
- Branch: `claude/learning-program-phase1`
- Base commit: `03c7828` (`codex/learning-program-foundation`)
- Status: complete, awaiting Codex review. Not merged, not deployed, no UI.

## Requested

The bounded Phase 1 of `.agents/backlog/2026-09-07-claude-learning-program-phase1.md`: two additive
tables, matching boot guards, schema-parity verification, authenticated teacher draft CRUD,
teacher-owned reads, publish validation through the existing pure contract, public reads of
published programs only, and a safe list endpoint for future Discover integration. Five program
types. Pagination and bounded limits. No payments, booking, membership, classrooms, Daily, LiveKit,
monthly behaviour, subscriptions, production data or `db:push`.

## Starting point, and what was preserved

The parked branch held one unpushed WIP commit from before the LiveKit correction — the Drizzle
schema, the boot guard, the pure state module and a container-local `scratchpad/pg.sh`. It was
rebased onto `03c7828` (a fast-forward: `03c7828` adds only review documents on top of the
`2568315` this branch already contained), so **none of Codex's work was overwritten**. The
PaymentSheet safety correction, `learningPrograms.ts`, its templates and tests, the marketplace
backlog, the memory note and the two review worklogs are all untouched by this change — the diff
against `03c7828` is entirely new files plus three registration lines.

`scratchpad/pg.sh` was removed: it hard-codes this container's Postgres layout and `su postgres`,
which is not true of the owner's Windows machine, so keeping it would have been a wrong route
handed over as a right one.

## Changed

**`lib/db/src/schema/learningPrograms.ts`** (kept from the WIP) — `learning_programs` and
`learning_program_modules`. Two new tables and no column anywhere else, which
`.agents/memory/schema-change-deploy-window.md` records as the safe shape: a new column on an
existing table takes sign-in and registration down between a deploy and `db:push`, and a new table
cannot, because nothing that already exists refers to it. Every draft column is nullable, because a
half-written program is a permitted state and NULL says "not written yet" exactly. No price, fee,
commission, payout, provider, ledger or enrolment column: none of those numbers is decided, and a
column invites a convenient constant to be put in it and later read as settled.

**`artifacts/api-server/src/lib/ensureSchema.ts`** — the boot guard, and one change to the WIP: the
DDL is now the exported constant `LEARNING_PROGRAM_DDL` and the guard executes it. That exists so
the parity gate tests *the statements that ship* rather than a copy pasted into a test file — a copy
would drift the first time somebody edited one and not the other, which is the exact failure the
gate exists to catch, reintroduced inside the thing meant to catch it.

**`artifacts/api-server/src/lib/learningProgramState.ts`** (kept from the WIP, three small fixes) —
the pure transitions, the row→draft mapping, the publication snapshot and `hasUnpublishedChanges`.
`delete` now returns `next: null` rather than a meaningless `"draft"`; the duplicated `archive`
branches are one branch with the reasoning written down.

**`artifacts/api-server/src/routes/learningPrograms.ts`** — new. Teacher: list (keyset-paginated,
status-filtered), create, read, save, publish, unpublish, archive, restore, delete, and the static
templates. Public: `GET /programs` and `GET /programs/:id`.

**`artifacts/api-server/src/lib/learningProgramState.test.ts`** — new, 24 pure tests.

**`artifacts/api-server/scripts/learning-program-tests/run.mjs`** — new, 135 checks against a real
API and a real database, including the schema-parity gate. Wired as `pnpm run test:programs`.

## Decisions and assumptions

- **A published program is served from its snapshot, never from the editable columns.** So a teacher
  may keep working on a revision and none of it reaches a student until an explicit re-publish,
  which increments the version. "Published content is immutable" is then a consequence of reading
  from a different place rather than a rule somebody has to remember at each write site. One `jsonb`
  column rather than a versions table: the smallest model that preserves what a student saw, and
  nothing yet needs the history.
- **Writing a draft needs only a teacher account; publishing needs an approved one.** A draft is
  private to its author and reaches nobody, so making a teacher wait for operator review before they
  may start writing would be a delay with no safety in it. Publication is where the account is
  checked, and the public read checks it again independently.
- **A paid teaching plan is deliberately *not* a door.** `ordinaryTeachingAccess` gates class
  creation on `subscriptionActive`; publishing a program is not creating a class, and no commercial
  rule about programs has been approved. Requiring a plan here would have been inventing a price
  gate the owner has not agreed to. **This is the assumption most worth Codex's attention** — if the
  owner decides programs are a paid feature, this is the line that changes.
- **Restore returns to draft, never straight to published.** Restoring says "I want this again",
  not "put it back in front of students unread".
- **A program that has ever been published cannot be deleted, only archived.** Somebody may have
  read it and acted on it, and the page is the only record of what was promised.
- **A suspended teacher's programs leave the public list without being deleted.** Visibility is a
  join in the query, not a stored flag, so it is right the moment the account changes.
- **Module order is the array order.** A client-supplied `position` is ignored: two steps claiming
  position 3 is a body a client can send and a state a reader has no honest way to resolve.
- **Moderation records, it does not gate.** `flagContent` — the same call `auth.ts`, `sessions.ts`,
  `teachers.ts` and `monthly.ts` already make — runs over every teacher-authored field under the
  surface `learning_program`. No second profanity system, and no teacher blocked mid-sentence by a
  word list. The publish validator is the thing that refuses, and it refuses *claims*.
- **Nothing infers a claim.** The public payload has no rating, enrolment count, "popular",
  "verified", availability or price, and the snapshot type has nowhere to put one.

## Verification

Everything below was run in this session, against a real Postgres.

| Gate | Result |
| --- | --- |
| `pnpm run typecheck` (4 packages) | clean |
| api-server unit suite | **465 passed, 0 failed** |
| `learningProgramState.test.ts` (new, pure) | **24 passed, 0 failed** |
| `pnpm run test:programs` (new, real API + DB) | **135 passed, 0 failed** |
| `pnpm --filter @workspace/sikshya run test` | 261 passed, 0 failed |
| `lint:design` | unchanged at 94 hex / 282 sizes |
| `git diff --check` | clean |

The focused suite covers what the brief asked for by name: all five program types published and
read back; publishing refused for an incomplete draft, for an exam program that does not name its
exam, for one guaranteeing a pass, and for an unreviewed account; ownership isolation across read,
edit, publish, archive and delete, with the same 404 for "not yours" as for "does not exist";
drafts and archived programs absent from both public routes and from the list; module order in the
draft, in the database, on the published page, and after a reorder; pagination bounds (an enormous
limit capped, a bad cursor refused, no overlap between pages); malformed ids and bodies; every
teacher route refused when signed out; and the seven booking, enrolment and monthly tables holding
the same number of rows at the end of the run as at the start.

### The parity gate, and proof that it works

`ensureSchema.ts` and the Drizzle schema are compared by executing `LEARNING_PROGRAM_DDL` into a
**throwaway Postgres schema** and diffing `information_schema` against `getTableColumns()` on the
Drizzle tables — every column's type, nullability and default, plus the three indexes and both
foreign keys. Nothing existing is dropped and `db:push` is never invoked, so it is safe to run
anywhere and deterministic however the test database was built.

It was checked by breaking each definition in turn:

- making `equipment` `.notNull()` in the Drizzle schema →
  `FAIL learning_programs: every column has the same type, nullability and default — equipment: notNull true vs false`
- deleting `"equipment" text` from the guard's DDL →
  `FAIL learning_programs: the guard creates every column the schema declares — missing: equipment`

Both restored; 135 / 0 again.

## Problems and surprises

- **The parity bundle failed twice for reasons that had nothing to do with the schema**, and both
  are recorded elsewhere in this repository: esbuild cannot resolve a bare import from a scratch
  file in `/tmp` (fixed with `nodePaths`, as `sikshya/scripts/bundle-for-browser.mjs` does), and
  importing anything that reaches `lib/logger.ts` outside production spawns pino's pretty transport
  by `__dirname`, which does not exist in an ES module (fixed by setting `NODE_ENV=production` for
  the suite process only, after the API child has been spawned with its own `NODE_ENV=test`). Both
  traps are now commented at the point they bite.
- **`readText` returned `undefined` behind a `null` type.** Unreachable through the patch route,
  which checks for absent first, but a cast that lies is a cast a later caller believes. Corrected.
- **The API unit suite is green here at 465/0.** Codex's foundation worklog recorded 439 passed / 1
  failed, the failure being `socialIdentity.test.ts` unable to resolve `jose`. That did not
  reproduce in this container at any point, before or after this change, so there was nothing to
  reproduce against `03c7828`. Worth flagging rather than quietly claiming to have fixed it: it may
  be environmental, and it is not something this change touched.
- Postgres was not running at the start of the session — the container is recycled between sessions
  and nothing in the repo restarts it.

## Fabrications found

None. Both places one could have appeared were checked rather than assumed:

- the public payload's key set is asserted against a list of the numbers this app has invented
  before (`rating`, `reviews`, `students`, `enrolled`, `popular`, `verified`, `price`, `available`)
  and the snapshot type has nowhere to put any of them;
- a teacher's `referenceSource` is carried through verbatim, and the suite asserts that
  `teacher_supplied` is not promoted to `official` anywhere in the read path — a teacher saying they
  follow a syllabus is not Fadko saying the syllabus is endorsed.

There is also no `?? 0` anywhere in the new code, and no default that turns a missing answer into a
stated one: an unreadable snapshot is left out of the list rather than rendered half-empty, because
a program page missing its outcome looks like a teacher who did not bother.

## Deliberately not changed

- Payments, booking atomicity, `lib/membership.ts`, refunds, payouts, enrolment, seat holds.
- Classroom sockets, the whiteboard, Daily, LiveKit — the pilot branch is closed and untouched.
- Recurring and monthly behaviour, teacher subscriptions, `recurring_sessions` and its relatives.
  No program column was added to `sessions`, to any recurring table or to any enrolment.
- Production data, environment variables, `db:push`, deployment, `VIDEO_PROVIDER`.
- Navigation and UI. **There is no Phase 2 UI in this change** — no screen, no route in the app, no
  Discover integration. The list endpoint is shaped for it and nothing more.
- `learningPrograms.ts` itself: the publish contract and its templates are Codex's and are reused
  verbatim rather than re-implemented.

## Remaining risks / next pickup point

- **The tables do not exist in production and must not be created by this branch.** They arrive
  through `db:push` when the owner runs it, or through the boot guard on first deploy. Both are
  additive; neither is a migration.
- **The publish gate assumption above is a product decision, not a technical one.** If programs are
  to be a paid feature, `publish` is the single line to change.
- **`hasUnpublishedChanges` compares whole snapshots as JSON.** Correct and cheap at this size; a
  program with forty modules is still a few kilobytes. If Phase 2 attaches materials to modules,
  this becomes the wrong shape and should move to a field-level diff.
- **Nothing reads these programs yet.** No student can enrol, and this change deliberately provides
  no way to — the enrolment model waits on the commercial questions the marketplace backlog lists.
- Next smallest review step: Codex reviews the authority path (`ownedProgram` → `transition` →
  `publish`) and the public read's join, then decides whether the draft/publish gates are where the
  owner wants them before any UI is built on top.

---

# Correction pass — Codex's Phase 1 review

- Date: 2026-09-08
- Agent: claude
- Branch: `claude/learning-program-phase1`
- Rebased onto: `b3692ab` (`codex/learning-program-foundation` — the approved classroom blueprint,
  the owner's three product defaults, and Codex's Phase 1 review)
- Reviewed commit: `58523f1`
- Status: complete, awaiting Codex re-review. Not merged, not deployed, still no UI.

## Requested

`.agents/worklog/2026-09-08-codex-learning-program-phase1-review.md`: two blocking findings and
three smaller corrections. Fix only those. Rebase onto the blueprint for durable context but
implement none of its later features.

The rebase was a fast-forward — `b3692ab` adds only documents on top of the `03c7828` this branch
already sat on — so nothing of Codex's was overwritten and nothing of this branch's was lost.
`.agents/backlog/2026-09-07-fadko-classroom-learning-blueprint.md` was read in full; it names
several things a published program will eventually need (schedule, capacity, completion method, a
versioned cancellation summary, price) and **none of them was added here**, because it is a product
guide rather than a licence to widen Phase 1.

## Blocking finding 1 — the snapshot reader promised to refuse and did not

`readSnapshot` said an unreadable snapshot was omitted rather than half-rendered, then normalised a
missing required string to `""`, a missing modules array to `[]`, and a malformed module member to
empty title and outcome. A corrupt row therefore reached `/programs` as a public page with no
outcome and no steps — which reads as a teacher who could not be bothered, not as data the app
cannot honestly show. Codex also noticed that the test named "refused rather than half-rendered"
never removed a required field, so it passed without exercising its own title.

Rewritten as rejections rather than repairs:

- every required string must be present, a string, and not blank;
- an optional field is absent, null, or a non-blank string — a blank string is malformed, not
  absent;
- the version must be a safe integer of at least 1, because a version is a count of publications
  and zero would mean "published and never published";
- the modules array must be a non-empty array of objects, each with a real title and outcome;
- positions must be whole, non-negative, unique and dense — a gap is a lost step and a duplicate is
  two steps claiming one place, and renumbering either would present a guess as the teacher's
  sequence;
- and then the reconstructed draft goes back through `validateLearningProgramForPublish`, so
  anything that could not have been published cannot be read back as published either. That last
  gate is the one that does not have to be maintained: a rule added to the publish contract
  tomorrow guards the read path too.

New `publishedSnapshotFor(row)` is what the public routes call. It reads the snapshot **and**
requires the version inside it to equal the row's own. The two are written by one statement, so a
disagreement means they came from different publications, and serving either half is serving a
promise nobody made.

A corrupt row now costs its page one entry in the list and nothing else: the cursor is taken from
the last row read rather than the last program rendered, so paging advances past it instead of
stopping on it.

## Blocking finding 2 — time-of-check/time-of-use on every write

Ownership, status and version were read outside a transaction and the write matched on id alone.

Every mutation now runs through one `mutate()` helper: `db.transaction`, `SELECT … FOR UPDATE` on
the program row, and **ownership and the state machine re-checked inside the lock** — so the
decision and the write are about the same row. Publication reads its modules from the same
transaction, so a snapshot is always one whole draft. A request whose expected state has moved on
gets a 409 naming the state it expected, rather than being applied to whatever it finds.

It is deliberately the same lock for every path, including delete, so no two of them can be in
flight together. The cost is that two tabs belonging to one teacher serialise for microseconds; the
alternative is data nobody can explain.

`recordActivity` also moved **out** of the transaction. It writes on its own connection, so a line
saying a program was published would have survived the publishing transaction being rolled back —
a record of something that did not happen, which is the defect class this project has found most
often. The activity is now returned from the transaction and written after it commits.

## Smaller corrections

1. **The list said "newest-published first" and ordered by id.** Fixed the query rather than the
   sentence: `ORDER BY published_at DESC, id DESC`, with a cursor of `<published_at ms>_<id>` and a
   row comparison `(published_at, id) < (…)`, so two programs published in the same millisecond are
   neither skipped nor repeated. A cursor naming only an id is now refused.
2. **Page sizes are whole positive numbers, capped.** `Math.max(1, Number(q) || 20)` passed `1.5`
   into the database's `LIMIT` and turned `"lots"` into the default without saying the request was
   wrong. One rule, refusing everything that is not a whole positive number; capping a large number
   is the single deliberate normalisation, because a client asking for a thousand means "as many as
   you will give me". Against `58523f1` the teacher-list case with `limit=1.5` returns **500**,
   which is the finding demonstrated exactly.
3. **Moderation reads the stored draft.** It was handed the modules from the *request*, which is an
   empty array whenever a request did not carry any — so a teacher fixing one word in their title
   had their whole learning path read as blank, and a flagged step already saved was never looked
   at again. The complete module set is now reloaded inside the transaction and moderated after it
   commits.

No new rule was invented about open moderation flags blocking publication. `flagContent` still
records for an operator and gates nothing.

## Verification

| Gate | Result |
| --- | --- |
| `pnpm run typecheck:libs` | clean |
| `pnpm run typecheck` (4 packages) | clean |
| api-server unit suite | **474 passed, 0 failed** |
| focused Learning Program state tests | **40 passed, 0 failed** (24 → 33 in the state file, plus 7 contract) |
| `pnpm run test:programs` | **212 passed, 0 failed** (135 before) |
| `pnpm --filter @workspace/sikshya run test` | 261 passed, 0 failed |
| `lint:design` | unchanged at 94 hex / 282 sizes |
| `git diff --check` | clean |

### The new tests fail against `58523f1`

Run before fixing, as asked, by restoring `routes/learningPrograms.ts` and
`lib/learningProgramState.ts` from `58523f1` and leaving the new suites in place.

- **Pure state tests: 25 passed, 8 failed.** Isolated to `readSnapshot` alone (the strict version
  of the file with only that function reverted), the eight are exactly the ones covering required
  fields, optionals, version, module arrays, module members, positions, contract compliance and
  "nothing corrupt is repaired".
- **`test:programs`: 168 passed, 44 failed.** Every failure names one of the findings:
  - corrupt snapshots served as public pages, in all nine corruption shapes;
  - a version-skewed snapshot served;
  - `and it is version 3, so the other publication was not silently overwritten — version 2`;
  - `snapshot(The draft before the save, 2) vs stored(The draft after the save, 3)` — a publication
    of a draft that no longer existed;
  - `a delete that set out while it was a draft is refused once it is published — 200` and the
    published program gone with its snapshot;
  - unpublish and restore applied to states that had moved on (`200` where `409` is right);
  - `every simultaneous publication counted — 1 -> 6, expected 11` — five of ten publications lost;
  - `republishing it moves it to the front` — the ordering claim;
  - five page sizes accepted that should not be, and `the teacher's own list follows the same rule
    — status 500`;
  - `and the stored steps are read again rather than an empty list — 1 -> 1`.

### How the concurrency tests are made deterministic

Each case opens a second Postgres session with `pg`, holds the program row with `SELECT … FOR
UPDATE`, fires the request under test, **waits until that request is genuinely stuck on a lock** by
polling `pg_stat_activity` rather than sleeping a guessed number of milliseconds, commits a change
from the held session, and then lets the request finish. The interleaving is a decision, not a coin
toss, and it does not become wrong on a slower machine.

Four staged cases — publish crossing a publication, publish crossing a complete save, delete
crossing a publication, and unpublish/restore crossing a transition — plus one genuinely raced
round of five simultaneous publish pairs, which asks the same questions of whatever ordering the
machine actually produces. The raced case is not a substitute for the staged ones and is described
as what it is.

## Problems and surprises

- **I introduced a bug and the new tests caught it.** Making `type` and `referenceSource`
  conditional in the save's `SET` meant a request carrying *only* `modules` produced an empty `SET`,
  which Drizzle refuses — so a modules-only save became a 500 and the reorder never happened. Two
  checks in section 6 failed. Fixed by always writing `updatedAt`, which is also the truthful
  answer: the program did change. Both module-only saves now assert their status so it cannot
  regress silently.
- **A plain `SELECT` does not block on `FOR UPDATE`**, which shaped the Save/Publish test. The old
  code's reads were all plain, so no lock the test holds can pause it *between* its row read and its
  module read. The property that is deterministically observable is the one that matters anyway:
  the published snapshot must be one whole draft **and** the draft that was current when the
  publication took effect. Old code publishes a draft that no longer exists; new code publishes the
  saved one.

## Fabrications found

None new. One near-miss removed: `recordActivity` inside the publish transaction could have written
"published, version N" for a publication that rolled back. Nothing had produced such a row, but the
path existed and is now closed.

## Deliberately not changed

- Everything in the previous section's list — payments, booking, enrolment, membership, refunds,
  payouts, subscriptions, Daily, LiveKit, sockets, classrooms, whiteboard, monthly behaviour,
  production data, `db:push`, deployment, UI, navigation, Discover.
- The blueprint's later features. It is durable context on this branch and nothing more.
- The flag-for-operator moderation policy, explicitly.
- The publish gate assumption from the previous pass — operator approval yes, paid plan no. Still
  the line to change if the owner decides programs are a paid feature.

## Remaining risks / next pickup point

- **The row lock serialises a program's mutations, including its reads inside `mutate`.** At Phase 1
  volumes that is invisible; if a future screen polls a program while saving it, the lock is the
  first thing to look at.
- **`publishedSnapshotFor` will reject rows written by an older deploy** if the snapshot shape ever
  changes. That is the intended behaviour — better withheld than half-drawn — but it means a shape
  change is a migration of stored snapshots, not just a code change. Worth a note before Phase 2
  adds anything to them.
- **The concurrency tests need a real Postgres and a second connection.** They will not run in an
  environment without one, and they are the only tests here that depend on `pg` directly.
- Still unverified: nothing reads these programs yet, no student can enrol, and the tables do not
  exist in production.
