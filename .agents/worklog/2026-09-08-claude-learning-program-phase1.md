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
