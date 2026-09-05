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
