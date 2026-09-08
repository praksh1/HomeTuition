# Learning Program Phase 1 — Codex review

- Date: 2026-09-08
- Reviewed branch: `origin/claude/learning-program-phase1`
- Reviewed commit: `58523f1`
- Review branch: `codex/learning-program-foundation`
- Status: **changes requested; do not merge or deploy**

## Scope and result

Claude kept the implementation within the requested Phase 1 boundary: two additive tables,
teacher-owned drafts, explicit publication, frozen public reads, program templates, public listing,
schema boot guard and tests. No payment, booking, enrolment, classroom, provider or existing-table
behavior was changed. `git diff --check` is clean.

The pure Learning Program tests passed independently on Windows: 31 passed, 0 failed. The API
package typecheck initially saw stale `@workspace/db` output; after the required `typecheck:libs`
build it passed. The real-Postgres route suite was not independently rerun in this Windows review.

## What is good and should be preserved

- New tables instead of risky new columns on existing production tables.
- Teacher identity comes from authentication rather than the request body.
- Draft creation is allowed before approval; publication requires operator approval.
- Public reads require published status, approved teacher and a non-suspended account.
- Student-visible content comes from an explicit published snapshot rather than live draft fields.
- Five conditional program types reuse the existing publish validator.
- No price, popularity, rating, enrolment or availability number was invented.
- Schema guard DDL is exported and tested against the Drizzle definitions rather than copied into
  the parity test.

## Blocking finding 1: public snapshot validation is not actually strict

`readSnapshot()` says an unreadable/version-skewed snapshot is refused rather than rendered
half-empty, but it converts missing or wrongly typed required strings to `""`, converts a missing
modules array to `[]`, and accepts malformed module members with empty title/outcome. It validates
only the outer object, type, reference source and numeric version.

Consequences:

- a corrupt or older snapshot can reach `/programs` and `/programs/:id` as an empty-looking public
  program;
- the behavior contradicts the route's promise that invalid snapshots are omitted;
- the existing test named “refused rather than half-rendered” does not remove a required string or
  corrupt a module, so it passes without proving its title.

Required correction:

- strictly validate every required published string, optionals, module array and module member;
- require a positive safe-integer version, dense/unique non-negative module positions, and the
  publish contract's minimum valid module content;
- reject, not normalize, a snapshot that would fail the current publish validator;
- public routes must also reject a snapshot whose version disagrees with the row's current version;
- add focused tests removing/wrong-typing each required field, corrupting modules/positions and
  creating a row/snapshot version mismatch.

## Blocking finding 2: write routes have time-of-check/time-of-use races

Ownership and state are read before write transactions, and updates/deletes later match only the
program id. Publication reads the row and modules outside a transaction and then overwrites by id.
Delete similarly decides a draft is deletable and later deletes by id.

Consequences under two simultaneous requests:

- two publish requests can both read version N and both write version N+1;
- Save and Publish can interleave so the snapshot combines a program row and module set from
  different drafts, or publishes a draft the teacher did not review as one unit;
- Delete can read “never-published draft”, race with Publish, and then delete the newly published
  program and its snapshot;
- Archive/restore/unpublish can apply a transition to a state that changed after it was checked.

Required correction:

- serialize each program mutation in a database transaction with a row lock, or use a complete
  optimistic compare-and-swap design that covers the program row and module replacement;
- repeat ownership/state checks inside the protected mutation;
- read the row and modules used for publication from the same protected transaction;
- conditional delete must prove the row is still the same never-published draft at deletion time;
- return an honest conflict response for a superseded request rather than silently overwriting;
- add deterministic concurrency tests for simultaneous Publish/Publish, Save/Publish,
  Publish/Delete and state-transition pairs. Prove the final snapshot is one complete draft and a
  published program cannot be erased by a stale delete.

## Smaller corrections required in the same pass

1. Public-list copy says “newest-published first” but the query orders by descending id. Either use
   an honest created/id description or implement a stable `(published_at, id)` cursor; do not leave
   the claim and behavior different.
2. Page limits should be parsed as bounded positive integers. Decimal values such as `1.5` must not
   be passed to the database limit API; refuse or deliberately normalize them and test the rule.
3. After a partial draft patch, moderation is called with `modules.value`. When `modules` was not in
   the request, that is an empty array rather than the program's stored modules. Reload the resulting
   complete module set before moderation so the scan describes the saved draft.

Whether an open moderation flag blocks publication is a separate product/content-safety decision;
do not invent that policy in this correction. Preserve the existing flag-for-operator behavior.

## Deliberately not requested

- No UI, navigation, Discover integration or Phase 2.
- No payment, booking, enrolment, payout, refund or subscription gate.
- No LiveKit/Daily/classroom work.
- No production `db:push`, merge or deployment.
- The approved classroom/product blueprint at `d04d40e` should be rebased into the branch for
  durable context, but its later features must not be implemented in this Phase 1 correction.

## Next action

Claude should rebase the branch onto `origin/codex/learning-program-foundation` at `d04d40e`, fix
only the findings above, add regression tests that fail against `58523f1`, run the full previous
gate set, commit and push to the same branch, then stop for another Codex review.
