# Programs on teacher profiles and follower news

- Date: 2026-09-09
- Agent: Codex
- Branch: `codex/programs-profile-follow`
- Base commit: `9f28ed9`
- Status: complete; owner verified; production release pending

## Requested

Continue the Learning Programs rollout after the owner passed the Phase 2B preview. Add the two
adjacent, non-commercial pieces without inventing enrolment or payment rules:

1. show a teacher's genuinely published programs on that teacher's student-facing profile; and
2. tell followers once when that teacher first publishes a new program.

The owner also asked for continuous progress with an explicit manual-test handoff rather than an
ambiguous pause.

## Changed

- `GET /programs` accepts a validated `teacherProfileId` filter and applies it inside the same
  `publiclyVisible()` query used by Discover. Draft, archived, taken-down, suspended-teacher and
  unapproved-teacher programs remain excluded.
- The first transition of a program from never-published to published prepares one
  `program_published` event for every follower. A later re-publication of edited material does not
  notify again. Follower lookup is done while the program row is locked; dispatch starts only after
  the publication transaction commits.
- `program_published` was added through all four notification layers: server event/email contract,
  server preference mapping/defaults, app socket event/local notification, and app preference
  controls. Tapping either an in-app or device notification opens the immutable public program.
- `TeacherProgramsSection` owns a separate paged request so the teacher profile's 20-second live
  class refresh does not repeatedly download programs. A genuine empty result hides the section;
  a request failure is stated and retryable instead of being presented as "no programs".
- `TeacherProgramsPanel` reuses the Phase 2B `ProgramCard`, design tokens and 44-point interaction
  floor. Four programs load initially and additional pages remain available.
- The student teacher profile renders the section immediately before class booking.
- Both deployment workflows now run the relevant gates. Production runs the real-database Program
  route suite and rendered Discover/profile suite; preview additionally gets its own disposable
  Postgres service and runs Programs, attendance/dispute evidence, and rendered Discover/profile
  before uploading anything. The prior workflows contained none of those Program gates.
- While preparing the release, GitHub Actions exposed an older, real refund-evidence defect:
  successful dispute creation did not write the `dispute.create` activity row asserted by the
  attendance suite. The case, opening ticket event and activity row are now one database
  transaction, so an operator cannot receive only part of that evidence.

## Decisions and assumptions

- `teacherProfileId` is intentionally distinct from a teacher user id. The public route joins the
  profile table and filters its public id; follower delivery continues to use the teacher user id
  stored by the existing follow relationship.
- "New program" means the first publication of one program id. Taking it down and re-publishing,
  or publishing a revised snapshot, is not new and must not create follower spam.
- Program email is off by default. Push/in-app news is on by default and has its own visible
  preference. Existing stored preference rows inherit this new default through `readPrefs`.
- No price, schedule, seats, enrolment count or join action was added because no commercial Program
  contract has been approved.

## Verification

- `pnpm run typecheck`: passed across all four application packages when run outside the Windows
  workspace sandbox so pnpm could resolve junctioned dependencies.
- API unit suite: 474 passed, 0 failed after the final dispute correction.
- Sikshya unit suite: 351 passed, 0 failed.
- `test:discover`: 160 passed, 0 failed at 390 and 1440 pixel viewports.
- `lint:design`: passed with the existing baseline unchanged at 94 hex literals and 282 raw font
  sizes; no new leaks.
- `git diff --check`: passed after the worklog and final dispute correction.
- Real-database `test:programs` and `test:attendance`: not available on this Windows host. They were
  added/retained as required GitHub Actions gates. Both passed in the successful isolated-preview
  run `34437689401` before deployment.
- Isolated-preview run `34437689401`: passed all steps in 4m56s — staging-health guard, typecheck,
  disposable API/schema setup, Program/follower contract, attendance/dispute evidence, Chromium
  install, 390/1440 rendered Program/profile checks, preview-safety tests, Expo web build,
  production-host exclusion, Cloudflare deployment and served-bundle verification.
- Public staging checks after deployment: `/api/healthz` returned `ok`; public profile id `1`
  returned exactly one published program; the preview returned HTTP 200.
- Manual Codex browser smoke: after a hard reload, the Staging Review Teacher profile rendered its
  `Learning programs` section before `Book a class`; `View program` opened `/program/1` and rendered
  the immutable details and learning path. This was the machine-assisted smoke before the owner's
  independent check.
- Owner manual verification: passed on 2026-09-10. The owner checked the deployed preview and
  approved moving this phase to production.

## Production release follow-up

- The reviewed branch was fast-forwarded into `main` at `d0784a8` and pushed after the owner's
  approval. Production workflow run `34460883367` correctly stopped before Cloudflare deployment.
- Every server contract passed. The browser journey reached the monthly-class Discover flow and
  failed because Programs is now the intentional first Discover view while the older journey still
  looked immediately for a control rendered only in the Teachers view.
- This was a test-navigation regression, not a product rollback and not a timing problem. The
  journey now taps the visible `Teachers` Discover sub-tab before asserting and opening Monthly
  classes, matching the path a student actually follows. It does not add a delay or weaken an
  assertion.
- The production site was not changed by the failed run; deployment steps occur only after every
  gate passes.

## Problems and surprises

- Importing the data-owning profile section into the isolated render harness pulled in
  `expo-router`, which that esbuild harness does not provide. The visual portion was split into the
  pure `TeacherProgramsPanel`; the production container still owns fetching and navigation.
- The first rendered-suite integration left the harness on its teacher-profile scene, causing later
  Discover assertions to fail because their chips were genuinely absent. The suite now restores its
  populated Discover scene before continuing.
- A failed next-page request initially left the retry state active while a retry was in flight,
  allowing repeated taps. Dispatch now immediately returns to the ready state and shows one disabled
  progress control until the request settles.
- The production workflow for Phase 2B failed at `filing it is written down`. Inspection proved this
  was not a race: the route had never written `dispute.create` at all. The test dated from the same
  earlier change and could pass only when stale/shared data happened to satisfy it. The correction is
  transactional rather than adding a timing delay to the test.
- A sandboxed package-only typecheck falsely reported `jose` and `livekit-server-sdk` missing because
  it could not traverse installed workspace junctions. The complete elevated repository gate passed.
- The first strengthened preview run (`34437168151`) stopped before deployment because the new job
  asked `test:programs` to start `dist/index.mjs` without first building the API or creating the base
  schema. That was a workflow-wiring fault, not a Program failure: the API never came up and no
  assertion ran. Preview now mirrors production's disposable-database setup by running `db:push`,
  building the API, starting its shared test instance and waiting for health before either contract.
- The second preview run (`34437465007`) proved both real-database contracts passed, then stopped
  because the preview runner had no Playwright/Chromium installation. Production already installed
  it for the same rendered harness; preview now does too. No Worker was uploaded in either failed
  run, which confirms the new gates fail closed.
- The first authorized production run (`34460883367`) stopped in `test:monthly-browser` after the
  Discover redesign made Programs the first view. The output itself showed the Programs/Classes/
  Teachers tabs and no monthly entry, proving that waiting longer could not help. The correction
  explicitly selects Teachers before looking for the existing monthly-class entry.

## Fabrications found

One test-environment fabrication: the old attendance test could appear to prove dispute audit
evidence existed when a reused database already contained a matching row. The production workflow's
fresh database exposed that the application never created the row. The product response did not
fabricate a user-facing claim, but the prior green check did.

## Deliberately not changed

- No Program joining, enrolment, payment, price, schedule, completion, certificate or classroom
  relationship.
- No booking, membership, Monthly-class, Daily, LiveKit or WebSocket classroom behavior.
- No database migration or destructive schema action.
- No production or staging data was edited.
- The reviewed branch was later fast-forwarded into `main`; the first production workflow failed
  closed before any Worker deployment, as recorded above.

## Remaining risks / next pickup point

1. Push the monthly-journey navigation correction and require a completely green production run.
2. Verify both the Railway API health and the public Worker after that run; do not infer deployment
   from a successful push.
3. The isolated preview/staging pair remains deployed and profile id `1` has one harmless published
   staging program.
4. Commercial Program rules remain a separate owner decision and must not be inferred from this
   feature.
