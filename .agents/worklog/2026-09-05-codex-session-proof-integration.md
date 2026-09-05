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

Implement the shared session-scoped lock in a dedicated branch, prove the ingest-versus-sweep race
with Postgres, and add a fail-closed database invariant check for the participant dedupe index.
Only after those pass should the integration branch be considered for a disabled preview deploy.
