# Claude task — Learning Program schema and read API

Status: **queued, not active**. The LiveKit pilot review at
`.agents/worklog/2026-09-07-codex-livekit-pilot-review.md` has blocking corrections. Finish those
and receive Codex's re-review before beginning this task.

After that review closes, work on a new branch from the reviewed integration base; do not merge,
deploy, purchase or enable anything.

Read in order: `CLAUDE.md`, `.agents/memory/MEMORY.md`, `HANDOVER.md`, `DESIGN.md`,
`.agents/backlog/2026-09-07-learning-program-managed-marketplace.md`, and
`artifacts/api-server/src/lib/learningPrograms.ts` plus its tests.

Build the additive Phase 1 persistence and read boundary only:

1. Add `learning_programs` and `learning_program_modules` to the Drizzle schema and the runtime
   `ensureSchema.ts` path, following the project's additive-deployment safeguards. Draft/published/
   archived only. Do not add a program column to `sessions`, recurring tables or enrolments.
2. Store the fields in the pure contract, module order, owner teacher, timestamps and a versioned
   publication snapshot. Do not add price, payment, payout or provider fields.
3. Add authenticated teacher draft CRUD and preview plus public published-program reads. A teacher
   may mutate only their own drafts. Published content is immutable: revisions create a new
   version or return to draft through an explicit, tested transition; choose the smallest model
   that preserves what a student previously saw.
4. Reuse `validateLearningProgramForPublish`; saving an incomplete draft is allowed, publishing is
   not. Run existing moderation checks on every teacher-authored free-text field and test the
   review/flag behavior without inventing a second profanity system.
5. Public reads expose only reviewed/approved teachers and published programs. Do not infer
   verification, ratings, availability, outcomes or curriculum authority.
6. Add unit, authorization, schema-parity and route-contract tests. Test the four pilots in the
   pure contract and one unknown/new program type refusal.

Hard boundaries: do not touch payments, booking atomicity, `lib/membership.ts`, refunds, payouts,
classroom sockets, Daily, LiveKit, existing monthly behavior, production data or environment
variables. No destructive migration and no wide-table column addition.

Before handing back, run `pnpm run typecheck`, API unit tests, the narrow new route tests,
`git diff --check`, and any schema parity gate. Write a detailed `.agents/worklog/` entry covering
files, decisions, failures, fabrications checked, tests and everything deliberately not done.
Commit and push the branch, but do not merge or deploy. Report commit, branch, exact gates, known
risks and the next smallest review step.
