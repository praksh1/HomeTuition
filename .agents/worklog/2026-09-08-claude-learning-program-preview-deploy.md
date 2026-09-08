# Learning Program — preview deployment

- Date: 2026-09-08
- Agent: claude
- Branch: `claude/learning-program-phase2`
- Base commit: `b33f519` (Codex's Phase 2A acceptance record)
- Status: **half deployed.** The preview frontend is live and carries the feature. The staging API
  does not, and I cannot deploy it — see "What is blocked". **Not merged. Production untouched.**

## Requested

Deploy the accepted Learning Program branch to the existing preview environment — preview Cloudflare
frontend, Railway staging API, staging database only — make it testable by the non-technical owner,
run a deployed smoke journey, and record everything.

## What was deployed

| | |
|---|---|
| Commit deployed | `73c655a` on `claude/learning-program-phase2`, rebased onto `b33f519` |
| Preview frontend | https://hometuition-preview.praksh-dhakal.workers.dev — **updated, live** |
| Cloudflare Worker | `hometuition-preview` (`wrangler deploy --env preview`), never the production `hometuition` Worker |
| How | GitHub Actions "Preview a branch" (`preview.yml`), run [34249666085](https://github.com/praksh1/HomeTuition/actions/runs/34249666085), all 18 steps green |
| API the frontend points at | `https://hometuition-api-staging-production.up.railway.app` — the staging one |
| Staging API | **NOT updated** — still on the earlier commit; see below |
| Staging database | **No tables created**, because the API that creates them was not deployed |
| Production web, production API, production database | untouched, and nothing was pointed at them |

Nothing was purchased or activated. No `db:push`, no migration, no destructive command. No
production user was altered. No password, token, connection string or key appears anywhere in this
entry, and I neither hold nor asked for the Railway, Neon or Cloudflare credentials — `PREVIEW.md`
assigns those to whoever has the signed-in browser session.

### The frontend deployment, verified

- The workflow's own guards passed: the staging API answered `{"status":"ok"}` before the build
  started; the built bundle was grepped for the production API host and did not contain it; and
  `scripts/verify-preview.mjs` confirmed the fingerprinted bundle is actually being served.
- Independently, by fetching the live site from here: the served `entry-*.js` contains the staging
  API host twice and the production host zero times, and contains the Learning Program code
  (`learning-programs`, `program-home-empty`, `program-type-chooser`, `program-studio-save`), which
  the previous preview did not.
- Rebuilding locally with the same command and the same `EXPO_PUBLIC_API_URL` produced
  `entry-60decd70378f7e5680540fec0c220284.js` and
  `__common-54cfc73c27d6cf5c5a42c967f13bec73.js` — **the same content-addressed names the preview is
  serving**, so the local build is the deployed artifact byte for byte.

## What is blocked, and by what

**The staging API does not have the Learning Program routes.** Checked directly:

```
GET /api/healthz                        -> 200 {"status":"ok"}
GET /api/learning-programs/templates    -> 404
GET /api/programs                       -> 404
```

That service deploys from `claude/excalidraw-whiteboard-sync-gjoqaz` (the PR #10 product branch),
which does not contain this work. Redeploying it is Railway dashboard work: `PREVIEW.md` states that
Claude handles the repository and never handles or asks for secret values, and that Railway, Neon,
Cloudflare and GitHub account work is done in the owner's signed-in session. This container holds no
Railway credential, and CI deliberately holds none either — "a token that can deploy the API can
deploy production".

**So the preview is not yet testable.** The screens are there; every request they make returns 404
and the app shows its honest "could not reach the server" states.

### The one remaining action

Point the staging Railway service at `claude/learning-program-phase2` (commit `73c655a`) and
redeploy. Before doing so, `PREVIEW.md` requires confirming in the dashboard that the service's
`DATABASE_URL` is the staging Neon database, that `SESSION_SECRET` differs from production, that
`VIDEO_PROVIDER` is `echo`, and that no withheld outbound credential is present.

The two tables need no migration: `ensureLearningProgramTables()` in
`artifacts/api-server/src/lib/ensureSchema.ts` runs `CREATE TABLE IF NOT EXISTS` for
`learning_programs` and `learning_program_modules` at boot, and both are **new tables**, which
`.agents/memory/schema-change-deploy-window.md` records as the safe shape — no column is added to an
existing table, so sign-in and registration cannot break in the window. If that guard fails it logs
and the rest of the API keeps working.

Nothing else changes: no environment variable needs adding, and the preview frontend is already
built and pointing at that service.

## The smoke journey

The owner's checklist was walked by machine first, so that what they are handed has been shown to
pass. `artifacts/sikshya/scripts/program-smoke/run.mjs`, wired as `pnpm run test:program-smoke`.
**56 checks, 0 failures.**

It drives **the deployed bundle** — the same fingerprinted files, listed at the top of every run so
they can be compared with what the preview serves. What it does not use is the staging server: this
container cannot reach the public internet, and the staging API has none of these routes, so
requests to that host are answered from a local API with the same code and a real Postgres. That
substitution is the one thing about this run which is not the preview, and it is why the run cannot
substitute for the owner's own pass.

Covered, in order: signing in; opening Programs from the dashboard; creating all five kinds; a
practical skill not being asked for a curriculum and an exam program being asked which exam; typing,
leaving with browser Back and being warned, cancelling and finding the words intact; reloading and
getting the browser's own warning; saving, leaving cleanly with no question, and returning to the
work; completing and publishing; editing afterwards and confirming the public API still serves the
**published** words and not the edit; republishing to version 2; an unchanged program offering no
publish button and the version not moving; take down (and the public page going 404), archive,
restore, and deleting a never-published draft; and nine separate checks that no price, rating,
enrolment count, popularity or earnings claim appears.

### What failed during that run, and how it was corrected

1. **Console errors from the notification WebSocket.** `page.route` intercepts HTTP and not
   WebSockets, so the socket in the deployed bytes dials the real staging address, which this
   container cannot reach. Excluded by naming that exact host, not by matching "WebSocket" — eight
   were excluded and the count is printed on every run.
2. **Restore appeared not to work.** No request was sent and no error shown. The cause was in the
   test: every lifecycle action opens a confirmation sheet, including Restore, and the script was
   not confirming it. Worth recording as a small inconsistency in the product though —
   `programActions` marks restore `confirm: false` and the studio confirms it anyway, so that flag
   is unused metadata. The behaviour is fine and I did not change it during a deployment pass.
3. **Sign-in through the form does not complete under the request stand-in.** The form is filled the
   way a person fills it and the API answers `200`, which the run asserts; the session is then
   established by writing the token, the way this repository's other browser suites do. This is an
   artefact of answering a page's own `fetch` from Playwright rather than a server, not something a
   teacher would meet — but it does mean **form sign-in on the preview itself is unverified** and is
   the first thing to check when the API is up.
4. **Two suites need different builds.** `test:program-journey` needs a build pointing at the local
   API; `test:program-smoke` needs one pointing at staging. Running one after the other without
   rebuilding fails confusingly. Both scripts document their build command in their header.

## Gates re-run on the rebased branch

| Command | Result |
|---|---|
| `pnpm run typecheck` (root, all four packages) | pass |
| `pnpm run test` (`artifacts/sikshya`) | 315 pass, 0 fail |
| `pnpm run test` (`artifacts/api-server`) | 474 pass, 0 fail |
| `pnpm run test:programs` | 212 pass, 0 fail |
| `pnpm run test:programs-ui` | 232 pass, 0 fail |
| `pnpm run test:program-journey` | 71 pass, 0 fail |
| `pnpm run test:program-smoke` | 56 pass, 0 fail |
| `pnpm run lint:design` | no new leaks (94 hex / 282 sizes) |
| `git diff --check` | clean |

The preview workflow independently ran the root typecheck and the preview-verifier tests on the
GitHub runner from a clean checkout, which is the fresh-checkout proof the second review asked for.

## The account for testing

`staging.teacher.20260903@example.com` — the synthetic staging-only teacher created on 3 September,
already email-verified and approved, with a Base test-access grant recorded as expiring 2026-09-11
UTC. It exists only in the staging database. **Its password was deliberately established outside Git
so the owner holds it; it is not recorded here, and I did not read, request or use it.** No new
account was created on staging, and no production user was touched.

If that grant has lapsed by the time the API is redeployed, the established path is a fresh
staging-only synthetic teacher through the test-access mechanism, verified for that synthetic
address only — not a change to any real account.

## Deliberately not deployed

Production web, production API, production database, and `main`. No `db:push` anywhere. No student
discovery, enrolment, scheduling, payments, or Phase 2B. No paid service purchased or activated, no
spend limit raised — Railway's USD 10 cap is shared with production and stopping it stops production
too, so staging should be paused again after the owner's review.

## Remaining manual checks

- **Android.** `usePreventRemove` and the hardware Back button are wired and typechecked but have
  never run on a device. The browser Back guard is proven in Chromium only.
- **Safari.** Its back-forward cache and `beforeunload` handling differ from Chromium's, and the
  history-sentinel guard has not been tried there. Worth one pass on an iPhone.
- **Form sign-in on the preview**, per the smoke-run note above.
- **The preview's own browser console.** This container's Chromium has no route to the public
  internet (`ERR_CONNECTION_RESET` through the agent proxy), so console errors were checked against
  the identical local bundle, not against the live page.
