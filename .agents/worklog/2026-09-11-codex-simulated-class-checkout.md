# Simulated class checkout and ledger

- Date: 2026-09-11
- Agent: Codex
- Branch: codex/batch-simulated-checkout
- Base commit: 3b58906 (includes tested, inactive preview-video isolation)
- Status: complete (simulated checkout preview); real media activation pending

## Requested

Owner clarified that plain free enrollment is NOT the desired trial: students must simulate a
purchase of the quoted class, with teacher/Fadko accounting. Refund simulation is a later step.
Owner signed into preview operator and supplied Daily usage screenshots.

## Changed

- Added immutable batch_test_payments table, one simulated capture per batch booking, with
  frozen gross, 70/30 allocation, per-lesson amounts/positions and no real-money movement.
- Capture and enrollment share the existing locked booking transaction. Missing test-gateway
  confirmation is refused; declined simulation writes no booking. Retries return the same receipt.
- Student test checkout supports success, decline and cancel; never asks for PIN/card/wallet.
- Teacher class panel reads its own test receipts. Operator Program rehearsal has a separate,
  read-only latest-50 class-test ledger; it does not mix older Program rehearsal enrollments.
- No backfill of invented captures for earlier free test bookings.

## Decisions and assumptions

Use previously approved beta 70/30, no extra student fee. Allocations are held, not earned or paid
out. Real enrollment remains test/test_access/null reference; real payment and earnings queries
stay untouched. Snapshot allocation state is immutable; future refund/payout work needs separate
append-only events, not editing captures. No Daily recording activation.

## Verification

Initial local receipt tests 3/3; full named-workspace typecheck passed after building shared
declarations; design ratchet unchanged 94/282; checkout rendered tests 30/30 at390/1440.
Inspected generated390px booked screenshot. Additional operator panel and CI checks pending.

Continuation: full safety CI34669036220 passed at d7ca3d5, including disposable PostgreSQL,
both unit suites, program/batch booking, provider contract, proof, teacher/student grants and UI.
Extended local UI suite34/34 includes operator receipt view at390/1440; inspected390px operator
screenshot, no clipping. New allocation tests cover tiny prices and maximum safe-integer totals.
Teacher staging user1 test grant renewed through2027-01-10 via operator UI, success dialog
confirmed. Student user2 already active through2026-09-17; attempted renewal dialog stalled the
browser. Asked owner to Cancel, owner confirmed done; do not assume revocation occurred.

## Problems and surprises

Direct API typecheck before building shared libraries could not see new schema export. Full
root typecheck regenerates declarations and passes. Existing Program allocation helper forbids
total below lesson count, while Batch prices permit it; batch allocator conserves whole NPR with
zero allocations where necessary and BigInt total split. No change to old commercial helpers.
Chrome native browser access was stopped in preceding turn by safety URL detection. Owner supplied
screenshots instead:42 of10000 included participant-minutes used,0 recording/storage usage,
estimated$0.00. This is a point-in-time observation, NOT a hard spending cap. Do not copy the
billing-portal URL/session secret visible in the screenshot into logs or browser actions.

## Fabrications found

The older plain no-charge bridge did not meet owner's intended payment rehearsal. Corrected
wording and added genuine simulated capture records; never call them provider-confirmed receipts.

## Deliberately not changed

Production, gateway credentials, real money, real refunds/payouts, Monthly homework/chat,
membership logic, Daily selection/configuration and paid service plans.

## Remaining risks / next pickup point

Run disposable DB safety CI, deploy matched preview frontend/API only after passing, renew
synthetic test grants through fixed pilot deadline. Real Daily testing remains separate: namespace
and private-token code must be deployed before attaching credentials; action-time credential
authorization required. Owner has now signed in as operator; no new account needed.

### Release progress

- Code d7ca3d5; extra rendered operator checks/documentation6da5489, both pushed to
  codex/batch-simulated-checkout. Fast-forwarded staging source codex/program-batch-foundation
  to6da5489; main untouched.
- Safety CI34669036220 SUCCESS: API537, app373, Programs601, batch50, video42, proof125,
  teacher grants26, student grants108, class setup75, checkout30. Local extended checkout/operator34.
- Railway staging deployment486424b6-ba04-453b-807b-0a6e3afd81b0 ACTIVE; startup log confirmed
  learning program/test-booking tables present. Existing stage payment mode remains SIMULATED.
- Preview web run34669241451 in progress at this checkpoint; do not claim website released yet.
- Owner cancelled the blocked student-grant dialog; re-read showed same active grant through
  17Sep2026. No revocation or renewal occurred for student. Teacher renewal succeeded.
- Asked action-time permission to attach stored Daily credential to staging/private namespaces;
  awaiting answer. VIDEO_PROVIDER remains echo. Do not call any automated echo proof real media.

### Verified preview handoff

Preview run34669241451 SUCCESS at6da5489. Worker30a77f51-f2bc-46df-b4d6-4f54acc0f12c.
Workflow verified served HTML and3 exact bundles against the staging API. Operator's real signed-in
preview at /program-commerce shows new Class checkout test ledger; Show test receipts returned
the honest empty state, proving new authenticated endpoint and table work together on deployment.
No synthetic purchase was made in shared staging by this turn; owner performs student checkout.
Manual Android/iPhone and real media remain unverified. Production main untouched, no purchases.
Use preview student account to open published class -> Try test checkout -> Simulate successful
payment, then review TEST receipt and lesson links. Operator reloads the new ledger; do not use
the older Program test-enrolment form below to test this new batch-specific checkout.

### Append-only settlement continuation

- Added `batch_test_ledger_entries`: one immutable event per operator decision and purchased
  lesson position. It never mutates the captured quote or receipt.
- Reused the approved Program allocation state machine: future to delivered review or replacement;
  complaint decisions; payout/refund only from their eligible states. A reason is required for
  refund and complaint verdicts. Impossible transitions return conflict instead of succeeding.
- Operator test ledger now shows held gross, simulated teacher payout, simulated Fadko earning,
  simulated student refund and actual money moved (always NPR0). Student and teacher read the same
  derived settlement through their existing scoped class endpoint.
- No provider/gateway call, no real payment row, no ordinary earnings, no real refund/payout.
- Local verification: root typecheck pass; API unit537 and app unit373 pass; receipt/state unit24;
  design ratchet unchanged94/282; browser checkout/operator settlement40/40 at390/1440. Disposable
  PostgreSQL integration cannot run on this Windows checkout (no local Postgres); its extended
  checks are wired into `batch-test-checks.yml` and must pass in CI before preview deployment.

### Settlement release result

- Commit `1837160` pushed to `codex/batch-simulated-checkout`; preview source
  `codex/program-batch-foundation` fast-forwarded to the same commit. Main remains untouched.
- GitHub safety run `34672621006` passed every step, including disposable PostgreSQL schema push,
  extended batch booking/settlement integration, all unit suites, video/proof/access contracts and
  the40-check phone/laptop browser flow.
- Railway staging deployment `120bc805-bf6a-4ba0-a84f-e33516702fe2` is ACTIVE / successful.
  HTTPS health returned200; unauthenticated ledger request returned401 (protected route exists).
- Cloudflare preview run `34672831042` passed and deployed commit `1837160`, including its own
  typecheck, disposable database/API checks, rendered class/program flows and production-isolation
  proof. Preview URL unchanged. Owner still needs to perform the operator settlement walkthrough.

### Participant settlement view

- Commit `269b661` adds the same derived, read-only settlement totals to the booked student's and
  class teacher's existing test-class panel. It shows gross TEST payment, original teacher/Fadko
  allocation, gross still held, teacher test-paid, Fadko test-earned, student test-refunded and
  actual money moved (always NPR 0). Lesson rows use human-readable settlement state labels.
- No participant can make a settlement decision. Operator authority and the append-only event route
  are unchanged. Older API responses remain readable through honest zero/fully-held fallbacks.
- Local gates: full four-workspace typecheck; app unit 373; design ratchet unchanged 94/282; browser
  checkout/ledger 40/40 at 390 and 1440; diff check clean.
- GitHub safety run `34673306726` passed against disposable PostgreSQL. Cloudflare preview run
  `34673450705` passed and deployed commit `269b661`. Railway staging deployment
  `5d8f257b-ebe0-4c96-baaf-b13dc9b3ee00` is ACTIVE / successful on the same commit.
- Staging video remains `echo` after the unsuccessful Daily room attempt. Daily credentials and
  namespace remain inactive; production video, production API and `main` were not changed.

### System-owned settlement and operator exception desk

- Owner's real walkthrough exposed a product-design failure: the operator screen asked a human to
  manufacture ordinary facts with buttons such as delivered, cancelled, complaint opened and
  complaint window closed. The owner could not tell what they were supposed to do. Those controls
  are removed from the normal operator UI. The page now explains that Fadko updates routine test
  accounting from recorded classroom/session facts and student-created support cases. Ordinary
  receipts say `No operator action needed`; cancellation/dispute states link to support cases.
- Added a pure automatic transition policy and tests. A scheduled lesson does not count as
  delivered merely because its status says completed: recorded teacher presence is also required.
  A qualifying completed lesson opens its review period; the 48-hour window closes automatically
  from the scheduled end; a complaint created by that booking's student freezes only that
  student's allocation; a teacher-cancelled session becomes a replacement/refund exception.
- Automatic synchronization appends immutable system events with no actor and never confirms a
  real payout or refund. It runs before participant and operator test-ledger reads. If evidence
  synchronization fails, the API logs a warning and preserves the readable last-known ledger.
- This does **not** yet decide the outcome of a dispute, execute a payout/refund, or connect a case
  resolution to a settlement verdict. The internal rehearsal event API remains for automated tests
  and compatibility, but no longer appears as routine operator work.
- Commit `ea686d5` contains the product change. CI first failed because the booking journey tested
  a timetable clash only after intentionally completing the conflicting lesson. Commit `79a5c90`
  moved that proof to when both lessons are upcoming; no product logic changed. The next CI run
  exposed an existing timing race: the Programs API deliberately answers before a non-blocking
  moderation insert finishes, while the test queried immediately. Commit `37e1c2a` added a bounded
  two-second eventual assertion; it still fails if the promised moderation record never appears.
- Final safety workflow `34676572202` passed all steps: four-workspace typecheck, API/app units,
  design ratchet, disposable schema, Programs, batch booking and automatic settlement, video,
  evidence, teacher/student test access, and browser checks. Preview workflow `34676722500` passed
  and deployed commit `37e1c2a`. Railway staging deployment
  `3741cdd4-72f4-449f-a9fd-38762224c788` is ACTIVE / successful on the same commit.
- Production and `main` remain untouched. Staging video remains echo. No payment, purchase, Daily
  action, real payout/refund, or shared production-data mutation occurred.

### Discover catalog separation and first scaling pass

- The owner's walkthrough exposed that the public `/programs` feed mixed two different products:
  formal multi-step Programs and the immutable snapshots used internally by Simple Classes. The
  student then saw the same scheduled offer in both Programs and Classes, creating the apparent
  wall of unrelated cards. This was a catalog-boundary defect, not missing staging data.
- Added an optional, backward-compatible `presentation=program|class` filter to `GET /programs`.
  The default remains the old combined feed for existing callers. Student Course discovery and the
  teacher-profile Courses section now explicitly request only formal programs. The class catalog
  can select only simple-class snapshots. Invalid catalog values return 400.
- Simplified student language to `Courses`, `Live classes`, and `Teachers`. Course cards render in
  two columns on wider screens and one column on compact screens; the empty state points directly
  to Live classes and Teachers instead of explaining internal product architecture.
- Added API integration assertions proving a simple class cannot leak into the Course catalog and
  added rendered layout assertions at 390px and 1440px. Local results: app unit 373/0, Discover
  browser 184/0, typecheck clean when run outside the Windows sandbox so pnpm junctions are
  readable, design ratchet unchanged 94 hex / 282 sizes, diff check clean. Local real-Postgres
  Programs could not run because this Windows host has no `psql`; CI supplied the disposable DB.
- Commit `a3987db` pushed to `codex/batch-simulated-checkout`. Safety workflow `34677371198`
  passed every gate, including disposable PostgreSQL Programs and browser checks. Preview workflow
  `34677519959` passed and deployed the same commit. Railway staging deployment
  `c6634c63-e5cd-464d-85c5-09b0a653629b` is ACTIVE / successful. Direct staging API verification:
  1 course, 5 live classes, zero class snapshots in courses, zero non-class snapshots in classes.
- Production and `main` remain untouched. This is only the first Discover scaling pass; ranking,
  better search/filter controls, student dashboard/accounting and teacher dashboard/accounting are
  still future work. Staging Daily remains unresolved and no paid service was enabled.

### Participant test-money summaries

- The owner's walkthrough showed that student and teacher accounting existed only inside each
  class after pressing `Refresh test access`. Added a read-only summary to the screens people
  already use: Student > Sessions and Teacher > My classes. Students see test payment total,
  gross held by Fadko, test refunds and the explicit `Actual money charged: NPR 0`. Teachers see
  student test payments, gross held, their share still held, test-paid amount and the explicit
  `Actual money received: NPR 0`. Receipt details remain collapsible so the first view stays short.
- Added authenticated `GET /batch-tests/me/payments`. It accepts only student and teacher tokens;
  students can read only their bookings and teachers only bookings for programs they own. It
  synchronizes automatic settlement only for the unique batches already present in that scoped
  result, rather than refreshing the entire rehearsal ledger whenever Sessions opens. Operators
  receive 403 and no settlement controls were added to either participant screen.
- Added pure participant-total arithmetic tests, API authorization/row-scope integration checks,
  and rendered student/teacher scenes at 390px and 1440px. The rendered suite also asserts that no
  operator lifecycle controls leak into these summaries and that the card stays within the
  viewport. Local results: full four-workspace typecheck; API unit 544/0; app unit 375/0; rendered
  test-payment UI 54/0; design ratchet unchanged 94 hex / 282 sizes; diff check clean.
- Commit `b1c7f57` pushed to `codex/batch-simulated-checkout`. Safety workflow `34678316525`
  passed every gate, including the disposable PostgreSQL role-scope proof. Preview workflow
  `34678455814` passed and deployed the same commit. Railway staging deployment
  `71a78bf8-a613-402d-bf1e-2115dd524911` is ACTIVE / successful with message
  `Show participant test payment summaries`.
- Production and `main` remain untouched. These are test-only accounting summaries: no real
  payment, payout or refund occurred. The summary refreshes when its screen mounts; reopening the
  screen fetches the latest derived ledger. Staging Daily remains unresolved and was not changed.

### Participant payment history and privacy correction

- The owner passed the first summary but rejected `Held by Fadko` on participant screens. Removed
  test-money cards from Student Sessions and Teacher My classes. Student Profile now links to a
  dedicated `Payments & receipts` screen; Teacher Profile's existing `Teaching & earnings` screen
  now contains the matching earnings history. This keeps class lists task-focused and gives each
  person one predictable home for money records.
- Student totals now show test payments, test refunds and net test payments. Teacher totals show
  expected, pending, test-paid and (only when non-zero) reversed test earnings. Each receipt names
  its class, Nepal-time date, plain status and the amount relevant to that person. Neither screen
  displays Fadko custody, commission earned or a platform allocation amount. The teaching-policy
  card retains the teacher's planned 70% share but no longer displays a separate Fadko-share metric;
  the commercial rule itself was not changed.
- Privacy is enforced at the API boundary, not only by hiding text. Student responses omit teacher
  and platform allocations. Teacher responses omit student gross and platform allocations. The
  operator ledger remains unchanged and complete. Added integration assertions that inspect the
  serialized participant responses for forbidden internal fields.
- Local verification before commit: full four-workspace typecheck; API unit suite pass; app unit
  378/0; rendered test-payment/history flow 60/0 at 390px and 1440px; Teaching & earnings 30/0 at
  both widths; design ratchet unchanged 94 hex / 282 sizes; diff check clean. The first sandboxed
  typecheck/browser attempt could not read pnpm junctions on Windows; rerunning the same commands
  with normal workspace access passed. A side-by-side image viewer cropped the teacher capture;
  inspection of the original 390px image confirmed the rendered page itself was intact.
- No real payment, payout, refund, production deploy, purchase or Daily change occurred in this
  correction. Commit `962e906` was pushed to `codex/batch-simulated-checkout` and the preview
  source branch was advanced to the same commit.
- GitHub safety workflow `34687839500` passed every gate, including the disposable PostgreSQL
  participant-response privacy assertions. Preview workflow `34687992383` passed and deployed
  the exact commit. Railway staging deployment `d0bba418-bbfa-424e-a6d1-003755c5da3f` became
  ACTIVE / successful with message `Move participant payment history into profiles`.
- Browser verification against the deployed preview confirmed Teacher > My classes has no money
  summary, while Profile > Teaching & earnings shows expected, pending and test-paid earnings plus
  receipt history. `Held by Fadko`, Fadko fee and Fadko earnings were absent after a fresh reload.
  Student Profile > Payments & receipts is covered by the rendered route suite and remains for the
  owner's signed-in student walkthrough. Production and `main` remain untouched.

### Bank-style participant statements

- After passing the Profile move, the owner asked for money history to read like a bank app:
  pending teacher earnings first, posted transactions below, and amounts in one clean right-hand
  column. Rebuilt the shared participant history into `Pending` and `Posted` sections. Pending
  amounts and labels are italic; credits use a leading plus, student payments use a leading minus,
  and every amount stays in a non-wrapping right-aligned column on phone and laptop layouts.
- Student purchases and refunds are separate transactions rather than a refund silently changing
  the old purchase. A refund row names the class, exact lesson, receipt, refund event date in Nepal
  time and credited amount. Teacher rows distinguish pending, under-review, reversal-pending,
  test-paid and reversed earnings. The summary no longer double-counts an approved/refunded
  allocation as pending earnings.
- Extended the participant-safe API projection with only the fields these statements need: a
  student receives their own gross per-lesson amount; a teacher receives their own share; both may
  receive the latest state-change timestamp. No participant receives Fadko's allocation, custody or
  earnings, and no teacher receives the student's gross payment.
- Added pure ordering/refund/no-fabricated-zero tests and rendered statement checks at 390px and
  1440px. Local results before commit: app units 381/0; API units 544/0; rendered checkout and
  statements 70/0; Teaching & earnings 30/0; full four-workspace typecheck clean; design ratchet
  unchanged at 94 hex / 282 sizes; `git diff --check` clean. Screenshots were visually inspected;
  both participant statements were contained, readable and aligned.
- No real payment, payout or refund occurred. No production, Daily, membership, booking authority,
  complaint decision or operator ledger behavior changed. Preview CI/deployment and owner device
  review are still required at this checkpoint.
- Code commit `05821bf` was pushed to `codex/batch-simulated-checkout`. Disposable-database safety
  workflow `34689421702` passed all gates in 2m24s. The preview branch was advanced to the same
  commit; preview workflow `34689563024` passed and deployed it in 5m35s. Railway staging deployment
  `6c6a4cd3-995b-4357-84d1-96c69295ccea` is ACTIVE / successful with the matching commit message.
- Final browser verification used the owner's signed-in student preview at `/payments`. The two
  existing purchases rendered as right-aligned posted debits, newest first, with receipt and Nepal
  time; the account has no refund, so no refund transaction was invented. The rendered fixture
  separately proves that a real refunded allocation becomes its own dated class/lesson credit.
  Production and `main` remain untouched; owner device review is the only remaining gate.

### Price-specific teacher earnings estimate

- The owner passed the bank-style participant statements, then rejected the prominent `70% Teacher
  share` presentation on Profile > Teaching & earnings. The commercial split remains the internal
  allocation rule, but it is no longer advertised as the product or exposed as Fadko's earnings.
- Replaced that percentage block with a short explanation that a teacher will see a price-specific
  estimate while preparing a class. Removed the `Separate student fee during beta: NPR 0` line;
  a zero was implementation policy, not useful teacher-facing information.
- Added a display-only `classEarningsEstimate` derivation. It accepts the entered full price, the
  actual scheduled lesson count and the current server-provided teacher-share basis points. It
  refuses invalid/missing terms instead of inventing an amount. The payment ledger remains the
  authority for every real allocation.
- Class setup now shows a bank-like, right-aligned estimate in both `Class size and price` and the
  final review: total earnings **for each enrolled student** and the approximate amount per
  completed lesson. It says `Before applicable taxes` and warns that approved refunds or
  adjustments may reduce final payout. It calculates no tax, promises no payout date and does not
  multiply by unfilled seats.
- The calculation fetches the existing `/teachers/me/billing` policy rather than duplicating `70%`
  in the app. No payment, booking, refund, tax, payout, database or API behavior changed.
- Verification before commit: focused derivation tests 5/0; full app units 383/0; class setup
  rendered journey 93/0 at 360px, 390px and 1440px; Teaching & earnings rendered journey 32/0;
  four-workspace typecheck clean; design ratchet unchanged at 94 hex / 282 raw sizes;
  `git diff --check` clean. The first full typecheck found a tuple-spread type error in the new test;
  the test was corrected to destructure an explicitly typed tuple and the full gate passed.
- Full-page pricing captures were inspected at phone and laptop widths. The entered NPR 3,000 over
  five actual lessons rendered NPR 2,100 for each enrolled student and approximately NPR 420.00 per
  completed lesson, without a percentage split or horizontal overflow.
- Production and `main` remain untouched. Preview deployment and owner review are required before
  release.
- Code commit `8eae62b` was pushed to `codex/batch-simulated-checkout`. Disposable-database safety
  workflow `34693525350` passed every gate in 2m46s. The isolated preview branch was advanced to
  that exact commit; preview workflow `34693684363` passed and deployed it in 5m30s.
- A fresh reload of the deployed teacher `Teaching & earnings` page confirmed the `70%` and
  separate-fee-zero presentation is gone and the price-specific, before-tax explanation is live.
  The exact class-price estimate remains for the owner's create-class walkthrough. Production and
  `main` are still untouched.

### Student Discover class-catalog repair

- The owner published `Example: SEE Maths evening tuition` and could not find it from the student
  account. This was a real catalogue disconnect, not failed publication. A read-only staging query
  proved `/programs?presentation=class&q=Example%3A%20SEE%20Maths` returned published program id 11,
  while the legacy `/public/classes` endpoint returned no matching row. New Teaching Classes live
  in published learning-program snapshots plus batches; Student Discover's `Live classes` surface
  still read only the older one-off `sessions` product, and its default Courses query explicitly
  requested `presentation=program`.
- Reworked Discover's primary order to **Classes, Courses, Teachers**, with Classes as the default.
  Classes now has two explicit sub-catalogues: **Tuition & short courses**, backed by the published
  class snapshots, and **One-time lessons**, which preserves the legacy session product unchanged.
  A student can therefore find the teacher's new class without mixing it into curriculum-style
  Courses or removing older bookable lessons.
- The new class catalogue uses the existing server-side text search, 20-row keyset cursor pages,
  an explicit `Show more classes` action, stale-request suppression, and separate initial versus
  pagination failures. This avoids downloading an unbounded teacher/class list on a budget phone
  and avoids making one network request per typed character. Cards say `View dates & price` and
  open the existing detail surface, where batch dates, lesson count, remaining-price policy and
  test checkout are loaded.
- Deliberately not added: 20 extra per-card batch requests. The public program summary does not
  contain batch price or next-lesson data; doing an N+1 request fan-out would be the wrong scaling
  fix on 3G. A later premium marketplace endpoint can join currently open batch snapshots into a
  single class-card response with date, price and availability filters. The teacher-directory tab
  also still accumulates its older pages client-side and remains a separate 10,000-teacher scaling
  follow-up. No schema, payment, booking, publication or database rule changed here.
- Added rendered coverage for the exact owner-reported class title at phone and laptop widths,
  including search, class-specific copy, touch targets, no irrelevant Course-type filter chips and
  no horizontal overflow. Updated the navigation contract to require Classes and Tuition & short
  courses as the defaults while retaining One-time lessons.
- A clean Expo export initially failed because `react-native-worklets/plugin` requires
  `@babel/traverse`, but the app had not declared it while this workspace disables automatic peer
  installation. Added the already-resolved package as a direct dev dependency. The computer's
  newer global pnpm first rewrote unrelated optional-peer metadata across the lockfile; that noisy
  rewrite was discarded. The final lockfile has only the three-line importer entry and was
  validated offline with the repository-pinned pnpm 11.11.0.
- Final local gates: full four-workspace typecheck clean; app units **383/0**; rendered Discover
  **196/0**; staging-targeted Expo web export successful; design ratchet unchanged at **94 hex / 282
  raw sizes**; `git diff --check` clean. The 390px class-catalog capture was visually inspected and
  showed the exact class, its teacher and the `View dates & price` action without clipping.
- Production, `main`, Postgres data, simulated/real payments, Daily and LiveKit remain untouched at
  this checkpoint. Code still needs commit, push, disposable-database CI, preview deployment and
  the owner's signed-in student verification before any production release.
- Code commit `dc36c30` was pushed to `codex/batch-simulated-checkout`. Disposable-database safety
  workflow `34696296204` passed every application, API, booking, video, proof and browser gate in
  3m01s. The preview source branch was then fast-forwarded to the exact commit; preview workflow
  `34696465438` passed its isolated API/database, rendered-flow, bundle-destination and served-site
  checks and deployed in 5m26s.
- A fresh reload of the deployed signed-in student preview confirmed Classes is the first selected
  catalogue and Tuition & short courses is its selected sub-catalogue. The exact title
  `Example: SEE Maths evening tuition` appeared in the first result page, an exact submitted search
  returned that one class, and opening it rendered program id 11 with NPR 6,500 per student, eight
  lessons, Nepali-calendar start time and the private test-checkout action. A live screenshot also
  confirmed the cards, search controls and fixed navigation fit without overlap. The owner now has
  the preview for manual device review; production and `main` are still untouched.

### Student Discover rebuilt around intent and Nepal's education directory

- The owner rejected the tab-heavy catalogue as unsuitable for a marketplace with thousands of
  teachers. The new first decision is the student's real one: **Find a class** when they need help
  with a subject, exam, language or skill, or **Find my teacher** when they already know a name,
  school or place. Courses are retained under the class journey instead of competing as a third
  top-level product word.
- Replaced the teacher directory's unbounded client-side download/filter/sort path with a bounded
  12-row server page. Search, subject, province, district, local level, institution and affiliation
  choices are sent to PostgreSQL; later pages deduplicate by teacher id. Subject matching covers a
  teacher's primary subject and their declared subject list. This is the scaling correction for a
  5,000-teacher catalogue and avoids holding the whole directory on a low-memory phone.
- Added an explicit **School or location** finder backed by the same `/locations/nepal` and
  `/locations/nepal/facilities` hierarchy used in onboarding: Province -> District -> local level
  -> institution. Added a direct **Independent teachers** path for tutors who are not affiliated
  with a school or centre. No unnamed institution is invented and no geolocation permission is
  requested.
- Removed the legacy red `Monthly classes / PAY MONTHLY` promotion and the old paid-booking count
  from teacher results. Those belonged to the retired teacher-plan/legacy-session presentation and
  were not valid marketplace ranking signals. Current Tuition classes remain discoverable through
  the class catalogue built in the prior checkpoint.
- Tightened the public teacher-list projection while changing its search contract: email,
  subscription/tier internals, online state, earnings, session limit, raw price and historical
  booking count are no longer sent to every directory browser. The list exposes only the approved
  public profile and professional location/affiliation fields needed to find a teacher. Direct
  profiles also require an approved, unsuspended teacher.
- Corrected a pre-existing identifier mismatch in public program results: `teacher.id` now carries
  the teacher-profile id expected by `/teacher/[id]`, rather than the account user id. This makes a
  course's `Open teacher` action reliable instead of working only when two unrelated database ids
  happen to be equal.
- Teacher profiles and published class/course pages can now produce public share links using the
  native share sheet where available and clipboard fallback on the web. Their read-only public
  routes are allowed without signing in; follow, message and enrolment/payment remain authenticated
  actions. Signed-out pages also stop making unread-message and test-enrolment requests.
- Added pure pagination/query tests and expanded the rendered Discover suite at 390px and 1440px.
  The suite proves the two intentions, server page size, Nepal hierarchy, independent-teacher path,
  absence of the Monthly promotion and legacy booking counts, public share action, touch floors and
  no horizontal overflow. Final results: app units **387/0**, API units **544/0**, rendered Discover
  **218/0**, both app and API typechecks clean, design ratchet unchanged at **94 hex / 282 sizes**,
  `git diff --check` clean, and a full staging-targeted Expo web export completed successfully.
- Two local verification problems were environmental and were not hidden: running the screenshot
  suite alongside several compilers caused one 30-second screenshot timeout; running junctioned
  dependency reads inside the restricted Windows sandbox produced false module-not-found errors.
  The locked dependencies were verified, then the gates were rerun sequentially with normal
  filesystem access and passed. The API's PostgreSQL integration suite was not run locally because
  this Windows environment has no `psql`; disposable Linux CI remains the integration authority.
- Deliberately not added: paid placement, opaque recommendations, ratings, popularity, fabricated
  availability, automatic location tracking, or one request per teacher card. No schema, checkout,
  booking, refund, payout, classroom, Daily or LiveKit behavior changed. Production and `main`
  remain untouched; commit/push, disposable-database CI, preview deployment and owner device review
  are still required at this checkpoint.
- Code commit `c738d14` and the follow-up selection-state commit `bd6a8f3` were pushed to
  `codex/batch-simulated-checkout`. The follow-up came from visual review: opening **Exam, language
  & skills** correctly changed the catalogue but initially left its parent **Find a class** intent
  visually unselected. `discoverIntentFor` now makes that hierarchy explicit and unit-tested.
- Disposable-database safety workflow `34702972399` passed for the final commit, including all
  application/API/type/design, fresh-schema, Programs, booking, media, proof, test-access, student
  and browser gates. Railway staging then returned the new public teacher contract with Province,
  local level and institution and without email, plan, earnings or legacy booking fields.
- Final preview workflow `34704416368` stopped before deployment when two moderation-flag checks
  missed a swallowed insert in its disposable database; the other 602 Programs checks passed. The
  same final commit had passed that exact suite in the broader safety workflow. A single diagnostic
  rerun, `34704603692`, passed all preview gates and deployed in 5m57s. Nothing was bypassed and no
  product code was changed to conceal the intermittent test-storage miss; it is recorded here for
  the next agent if it recurs.
- Live preview verification reloaded the deployed Worker, opened **Find my teacher**, waited for the
  bounded staging result, and opened **School or location**. The page showed the two intentions,
  all three class catalogues, one teacher result with its institution, the Independent shortcut,
  and the complete Province list; the retired Monthly promotion and booking count were absent.
  Production and `main` remain untouched. The owner now has the final preview for physical device
  review.

### Public shared pages now have a safe account door and visible Fadko identity

- The owner opened a shared class in a signed-out private browser. Its test-checkout control still
  called the protected endpoint and printed the API's technical `Missing or invalid Authorization
  header` response. Signed-out visitors now see a plain **Sign in to join** / **Create a student
  account** choice before any booking code can run. The rendered contract proves that the public
  page sends no `/batch-tests/` request.
- Student sign-in accepts only a local `/program/<positive integer>` return path and ignores every
  other value. This returns a student to the class they intended to join without creating an open
  redirect. Registration still uses the established student-account route; it does not pretend a
  booking or payment has been made.
- Added a compact Fadko home control to signed-out program and teacher pages. It uses the real logo
  component and leads to `/welcome`; signed-in app users retain their ordinary Back control.
- Removed the public profile's historical paid-booking count, which is not a meaningful quality
  signal and should not be advertised. The subject count now combines the teacher's primary subject
  with the declared subject list, so a Mathematics teacher no longer appears as teaching zero
  subjects. Empty years-of-experience data is omitted rather than rendered as a dash statistic.
- A narrow-screen rendered check exposed an unrelated fractional-browser rounding issue: one
  location selector measured 43.99px despite a nominal 44px minimum. It now uses the existing 48px
  spacing token. No raw design value or new token leak was introduced.
- Final local gates: four-workspace typecheck clean; app units **390/0**; rendered public/Discover
  checks **232/0** across 390px and 1440px; design ratchet unchanged at **94 hex / 282 sizes**; and
  `git diff --check` clean. The local Expo export compiled all modules, but its post-build address
  assertion correctly rejected an ad-hoc same-origin value; the preview workflow remains the
  authoritative build because it injects the allowlisted Railway staging API URL. No production,
  database, payment, Daily or LiveKit state changed at this checkpoint.
- Code commit `ef0b7cf` was pushed to `codex/batch-simulated-checkout`. Disposable-database safety
  workflow `34706744858` passed every type, unit, fresh-schema, Programs, booking, media, proof,
  test-access, student and browser gate in 2m55s. The exact commit was then fast-forwarded to the
  preview source branch; preview workflow `34706923612` passed its isolated API/database, rendered
  flows, destination checks, production-target refusal and served-bundle verification in 5m51s.
- A normal refresh in the already-open preview tab initially retained the previous cached bundle;
  a hard refresh loaded the deployed one. The live signed-in teacher page then showed one correct
  Mathematics subject and no paid-booking or dash-placeholder statistics. The available browser
  session was authenticated, so the signed-out account doorway was not falsely claimed as a live
  incognito observation; it is proven by the two-width browser suite and the workflow's exact served
  bundle check, and remains the owner's short incognito verification. Production and `main` are
  still untouched.
