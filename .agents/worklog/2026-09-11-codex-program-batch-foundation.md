# Program Batch foundation — Codex — 2026-09-11

## Owner-approved product contract

- A Program is reusable editorial content; a Batch is one scheduled run of it.
- One Program may have multiple Batches.
- Capacity is 1–10 students.
- Every lesson names a Nepal date/time and lasts 30, 45, 60 or 90 minutes.
- The teacher states one all-inclusive total price in NPR for the full Batch.
- Enrollment will close when Lesson 1 begins. No prorating or late joining in beta.
- Future real enrollment is full-batch prepaid with a 70/30 teacher/Fadko split.
- This delivery is preview scaffolding only: no Join, Pay, Enroll, checkout, provider call or real money.
- Existing Monthly and Single Class behaviour is untouched.

## Implementation

### Database and boot safety

Added only two new tables in `lib/db/src/schema/learningPrograms.ts`:

- `learning_program_batches`: parent Program, draft terms, lifecycle, version and immutable public snapshot.
- `learning_program_batch_lessons`: ordered absolute start instants and durations.

No column was added to an existing table. This follows the measured deployment rule in
`.agents/memory/schema-change-deploy-window.md`: new tables cannot break existing bare selects while
an application deploy runs ahead of a database command. The same definitions were added to
`LEARNING_PROGRAM_DDL`, which `ensureLearningProgramTables()` runs additively and idempotently at API
startup. The parity harness was extended from five to seven Program tables, from nine to thirteen
indexes and from nine to eleven foreign keys.

### Server contract

Added `src/lib/programBatches.ts` and `src/routes/programBatches.ts`.

- Nepal wall-clock inputs are converted on the server using `Asia/Kathmandu`; a handset timezone
  cannot move the lesson.
- Publication uses the server clock and refuses past lessons.
- Capacity, price, valid calendar dates, lesson ordering and supported durations are validated.
- The first lesson instant is the enrollment cutoff; it is derived, not separately editable.
- Public reads use only validated immutable snapshots. Corrupt snapshots, row/snapshot version
  skew, Program-version skew, closed Batches, expired Batches, unpublished Programs, unapproved
  teachers and suspended teachers are withheld.
- Ownership is taken from the authenticated token. Another teacher and a missing row both receive
  the same not-found answer.
- Draft creation requires the parent Program already be published. Publishing also re-checks
  operator approval and that the parent Program is still public.
- No plan/subscription gate was invented, because the Program commercial rules have not yet made
  Programs a paid teacher feature.

Routes added:

- `GET/POST /learning-programs/:programId/batches`
- `GET/PATCH /learning-program-batches/:id`
- `POST /learning-program-batches/:id/publish`
- `POST /learning-program-batches/:id/close`
- `GET /programs/:programId/batches`

### Teacher UI

- A published Program now offers “Plan dates and price”.
- The separate planner lists every Batch and distinguishes Draft, Published and Closed.
- The editor asks for class size, one full price, and ordered lessons.
- Every field includes an example and explains how students use it.
- Save is separate from Publish; unsaved changes block publication.
- The in-page Back control warns before discarding unsaved work.
- A visible notice says this is planning-only and that students cannot pay or join.

### Student UI

- A Program page independently fetches published upcoming Batches.
- Each card names the total as “NPR … total for the full batch”, capacity, lesson count, every
  lesson in Nepal time, duration and the derived enrollment cutoff.
- There is no seat-remaining count because no Batch enrollment records exist.
- There is no Join or Pay button. The preview-only sentence is explicit.
- A Batch endpoint failure does not take down the Program page; it produces a specific unavailable
  message instead of pretending there are no Batches.

## What went right

- Full four-workspace typecheck passed after the route and new typed Expo path were wired.
- API and app unit suites accepted the new pure boundary tests.
- The design ratchet stayed at its existing baseline; no raw color or font-size leak was added.
- A read-only parallel audit caught all hard-coded assumptions in the schema-parity harness before
  deployment and confirmed that the existing shadow commerce enrollment must remain unlinked.

## What went wrong and how it was handled

- The first sandboxed full typecheck could not follow existing dependency junctions for `jose`,
  Expo social-auth packages and LiveKit. This was environmental, not a code failure. The gate was
  rerun outside the restricted sandbox; it then exposed one real nullable-id typing error in the
  new create route. That was corrected by using the loaded Program row's non-null id, and the full
  typecheck passed.
- `test:programs` could not start on this Windows checkout because it requires `psql` and the local
  PostgreSQL fixture on port 55432. `psql` is not installed here. This is an unverified gate until
  CI/staging runs it; it must not be reported as passing locally.
- The first public snapshot reader checked only the outer shape. It was tightened to refuse bad
  capacity, price, lesson positions, lesson ordering, invalid dates, unsupported durations and a
  mismatched cutoff before any malformed row can reach the UI.
- The first student fetch made a Batch API failure fail the whole Program page. It was changed to
  preserve the Program and state honestly that dates and price could not be checked.

## Deliberately not done

- No Batch enrollment table/link, seats remaining, checkout, payment, refund, allocation or payout.
- No changes to existing Program rehearsal enrollment; it is Program-level and cannot honestly
  represent multiple Batches.
- No changes to Monthly, Single Class, sessions, membership, Daily, LiveKit or classroom sockets.
- No database push, production deployment, purchase or third-party account change.
- No claim of real-phone verification. The owner must test preview on their laptop and phones.

## Verification ledger

- `pnpm run typecheck`: PASS across four workspaces after rerunning with dependency access.
- API unit suite: 499 passed, 0 failed; new Program Batch domain cases passed.
- Sikshya unit suite: 357 passed, 0 failed; new copy/time tests passed.
- `pnpm --filter @workspace/sikshya run lint:design`: PASS, baseline unchanged at 94 hex / 282 sizes.
- `git diff --check`: PASS.
- API production bundle: PASS.
- Expo static export: PASS against the Railway staging API; the bundle target and Fadko identity
  checks both passed. The first export used the Cloudflare site hostname as a same-origin API and
  correctly failed its built-in target check; rerunning with the actual staging API URL passed.
- `pnpm --filter @workspace/api-server run test:programs`: NOT RUN TO COMPLETION — blocked before
  tests by missing `psql` on Windows (`spawnSync psql ENOENT`). Must run in CI/staging.

## Next safe step

Commit and push this branch, let CI and staging run the real database/parity path, deploy only the
Railway staging server and Cloudflare preview, then give the owner one exact teacher link and one
student link. Do not merge to production before that physical test passes.

## Staging deployment and CI verification

- Committed and pushed `e1da6c5` (`Add Learning Program batch previews`) to
  `origin/codex/program-batch-foundation`.
- Changed only the Railway **staging** API service source branch from
  `codex/program-commerce-foundation` to `codex/program-batch-foundation` and started a deployment.
  Production was not changed.
- Verified `https://hometuition-api-staging-production.up.railway.app/api/healthz` returned HTTP 200
  with `{ "status": "ok" }`.
- Verified the new public route exists on staging: `GET /api/programs/1/batches` returned HTTP 200
  with `{ "batches": [] }`. This distinguished the deployed build from the preceding API revision.
- Dispatched GitHub Actions preview run `34556264494` for the exact commit `e1da6c5`. It completed
  successfully in 4m53s. The workflow passed typecheck, the real throwaway-Postgres Program tests,
  attendance/dispute checks, rendered Program discovery/profile checks, preview verification, web
  export, the production-target refusal check, and Cloudflare preview deployment.
- Preview URL: `https://hometuition-preview.praksh-dhakal.workers.dev`.
- The GitHub runner emitted only an infrastructure deprecation annotation: several official actions
  still target Node 20 and GitHub forced them onto Node 24. It did not fail the run and is unrelated
  to the application behavior.

## Current handoff state

The staging API and Cloudflare preview now run the same branch and commit. The remaining gate is the
owner's physical teacher/student review of Batch planning and read-only display. No production
merge/deploy, payment action, purchase, checkout, enrolment or real-money behavior has occurred.
