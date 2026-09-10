# Programs on teacher profiles and follower news

- Date: 2026-09-09
- Agent: Codex
- Branch: `codex/programs-profile-follow`
- Base commit: `9f28ed9`
- Status: complete; isolated preview pending

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
  added/retained as required GitHub Actions gates and must pass before any deployment is claimed.

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
- No branch was merged or deployed at the time of this entry.

## Remaining risks / next pickup point

1. Run the final API/app/design/diff gates and push the branch.
2. Let the preview GitHub workflow run both real Postgres suites. Do not deploy if either the first-publication
   notification contract or the restored dispute audit evidence fails.
3. Deploy only to the isolated preview/staging pair and seed or publish a harmless staging program
   for the test teacher if the profile otherwise has nothing visible.
4. Ask the owner to verify: program cards appear on the correct teacher profile; a genuine empty
   teacher has no empty Programs box; opening a card reaches the correct immutable program; failure
   and pagination states remain usable; one first-publication follower notification arrives and a
   revision does not create another.
5. Only after that manual pass merge and release. Commercial Program rules remain a separate owner
   decision and must not be inferred from this feature.
