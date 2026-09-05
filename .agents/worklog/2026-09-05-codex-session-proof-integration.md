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
