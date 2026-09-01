# Production account activation — Codex worklog

Date: 2026-08-31
Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`

## Owner request

Guide and perform the production activation for email verification, password recovery, and
social login. The owner authorized Railway access but explicitly prohibited paid third-party
services for this activation.

## Production audit

- Opened the owner's existing signed-in Railway dashboard read-only.
- Project `HomeTuition`, production environment, service `@workspace/api-server` is online at
  `workspaceapi-server-production-5a63.up.railway.app`.
- Railway source is `praksh1/HomeTuition`, connected to `main` with automatic deployments. This
  is why pushes to the Claude branch update neither the production API nor the production site.
- The active API deployment is the main-branch merge of pull request 9, not the current Claude
  branch.
- Railway currently shows a trial with `3 days or $3.69 left` and a prompt to choose a plan.
  No plan, billing method, or purchase was selected or changed.
- Audited variable names without reading or printing secret values. The API has database,
  session, Daily, and R2 variables. It has no email, Google, Facebook, or Apple variables.

## Cost and provider findings

- Cloudflare Email Sending is currently a public beta available on the Workers paid plan. It was
  not enabled because that violates the owner's no-paid-service instruction.
- Apple lists Sign in with Apple as an Apple Developer Program capability; that program is
  USD 99/year. Apple login remains implemented but hidden and unconfigured.
- Resend has a USD 0 tier (3,000/month, 100/day) but requires a privately owned sending domain.
  The existing `workers.dev` hostname is a shared platform domain, not a DNS zone the owner can
  verify as a sender.
- Brevo's published free tier is USD 0, has no time limit or card requirement, provides
  transactional email/API access, and allows 300 sends/day. This is the selected experiment path.

## Code changes

- Extended the existing mailer to support Brevo's REST API through `BREVO_API_KEY` plus
  `EMAIL_FROM`, without adding an SDK dependency.
- Preserved Resend compatibility and gives an existing Resend configuration priority during a
  staged migration, so adding Brevo cannot silently switch a configured deployment.
- Brevo requests use its required `api-key` header, structured sender/to objects, and both plain
  text and optional HTML bodies. API keys are never placed in request bodies or logs.
- Added three mailer tests: incomplete configuration remains honestly unavailable; Brevo uses
  the correct endpoint/shape without leaking its key; existing Resend configuration keeps
  priority.
- Added `BREVO_API_KEY` to `.env.example` without any value.

## Verification

- First verification run found two test-harness defects: TypeScript over-narrowed a variable
  assigned inside mocked fetch, and Node strip-types could not resolve the mailer's extensionless
  logger import. All 266 existing tests passed in that run. Both harness issues were corrected.
- API typecheck passed.
- API tests passed: 269/269.
- No real email was sent because no Brevo account/API key/sender has been created yet.

## Deliberately not done

- Did not merge to `main`, change Railway's connected branch, redeploy production, or change the
  production frontend. Deploying the stricter API before working email is proven would strand
  every new registrant at verification.
- Did not purchase or enable Railway, Cloudflare Email Sending, Apple Developer, or any other
  paid plan.
- Did not create an email/social provider account or persistent API/OAuth credential on the
  owner's behalf without the required account verification and action-time confirmation.
- Did not expose, copy, or record existing Railway secret values.

## Next safe production sequence

1. Owner creates and verifies a free Brevo account and sender identity.
2. Create a restricted Brevo SMTP/API key, then add `BREVO_API_KEY`, `EMAIL_FROM`, and
   `PUBLIC_APP_URL` to Railway without exposing the key in Git or chat.
3. Commit/push this mailer checkpoint, deploy the branch API only when mail can be exercised,
   and send a real verification and password-reset email to an address controlled by the owner.
4. Only after end-to-end mail passes, merge the matching API and frontend to `main` and deploy
   the production Worker.
5. Configure Google, then Facebook, as separate free checkpoints. Keep Apple disabled until the
   owner independently chooses to pay for Apple Developer membership.

## Activation continuation — Railway Hobby and Brevo

- The owner activated Railway Hobby and explicitly confirmed the following safeguards:
  a USD 5 compute email warning, a USD 10 compute hard limit, and no Railway Agent spending.
- Saved those limits in the Railway workspace and reopened the form to verify the stored
  compute values. Railway showed `Compute Usage Limit $0.00 / $10.00` and
  `Agent Usage Limit $0.00 / $0.00`. The hard limit is intentionally an emergency stop: every
  Railway workload goes offline if compute usage reaches USD 10 in a billing cycle.
- The new Hobby billing cycle showed USD 0.00 current usage, USD 5.00 included usage and USD
  5.00 credits when activated.
- Confirmed the Brevo Free account has one verified sender. It is a Gmail sender, and Brevo
  displays its honest deliverability warning that a free-mail domain is not recommended.
- Created one Brevo API key named `Sikshya Production API`, expiring 2027-08-31 (Brevo also
  expires an inactive key after 90 days). The key value was transferred only inside the secured
  browser session; it was not printed, copied into chat, committed, or written to this log.
- Added `BREVO_API_KEY`, `EMAIL_FROM`, and `PUBLIC_APP_URL` to the production Railway API
  service. Applied all three together and verified they appear as masked service variables.
- The configuration-only Railway restart completed successfully and the existing production API
  returned to `Active`. It still ran the old `main` code at that checkpoint; the new mailer does
  not become live merely because its variables exist.
- Deliberately added none of `GOOGLE_*`, `FACEBOOK_*`, or `APPLE_CLIENT_IDS` to Railway. The
  server therefore reports every social provider disabled, and the app renders no social-login
  buttons. The implementation remains in `artifacts/api-server/src/lib/socialIdentity.ts`,
  `artifacts/api-server/src/routes/auth.ts`, and
  `artifacts/sikshya/components/SocialSignIn.tsx` for future activation.

### Verification and problems encountered

- The root typecheck script again matched no artifact workspaces on Windows, so it was not
  accepted as proof. The API and app typechecks were run explicitly.
- The first explicit checks found the checkout had not installed the newly locked `jose`,
  `expo-auth-session`, and `expo-apple-authentication` packages. This was a local dependency
  state problem, not a source failure.
- The first locked install stopped because OneDrive briefly held a package file. A retry inside
  the restricted environment then received `EACCES` from the npm registry. It was stopped and
  rerun with approved network/filesystem access; the unchanged lockfile passed supply-chain
  policy verification and all 1,399 package links completed. No dependency versions or lockfile
  entries changed.
- The restricted filesystem view still could not follow pnpm junctions. The unchanged checks
  were rerun with approved junction access, matching the earlier documented Windows constraint.
- Final API typecheck: passed.
- Final app typecheck: passed.
- Final API unit tests: 269/269 passed.
- Final app unit tests: 154/154 passed.
- Final design lint: passed at the existing baseline of 223 hex literals and 429 raw font sizes;
  no new leaks.
- API production build: passed, producing `dist/index.mjs` (about 5.9 MB).
- The first web export command mistakenly supplied the Railway URL with a trailing `/api`.
  `utils/api.ts` already adds that path, so the resulting artifact would have requested
  `/api/api`. This was caught during artifact verification and that build was rejected before
  deployment.
- The corrected web production export passed with
  `EXPO_PUBLIC_API_URL=https://workspaceapi-server-production-5a63.up.railway.app` (origin only).
  Its build guard verified the baked API origin and the Sikshya app name. The normal Excalidraw
  CSS resource warning appeared but did not fail the export.

### Still pending after this checkpoint

- The owner explicitly confirmed the one-time recipient at action time. Brevo's signed-in test
  interface sent `Sikshya email verification test` to the verified Gmail test recipient. Brevo's
  real-time transactional dashboard recorded one event as **Delivered**, with zero bounces.
- A first attempt to call Brevo directly from the in-app browser's isolated Node environment
  failed with a network `AggregateError`; no email was sent by that attempt and no secret was
  exposed. The successful test used Brevo's own signed-in interface instead.
- Brevo created template ID 1 solely to support the UI test. It is named `New template`, remains
  **Inactive**, and cannot send automatically. It was left in place as an audit artifact.
- The 12 commits after production `main` have not yet been promoted in this subsection. Do not
  claim the new account screens are live until the `main` deployment and its health checks pass.

## Production promotion and CI fixture repairs

- Pushed the completed activation work to the Claude branch. A direct push to `main` was first
  rejected because GitHub had added merge history to `main` after the local checkout was made.
  No force push, reset, or history rewrite was used. Fetched and merged the remote `main`; the
  merge contained no file-level differences from the branch, then both refs were pushed normally.
- GitHub Actions run `33425152273` stopped before Cloudflare deployment. Compilation, design
  lint, server tests, and app tests passed, but old integration student fixtures did not supply
  the now-required date of birth. This was a test-data defect exposed by the new real signup
  rule, not a reason to weaken that rule.
- Added an explicit adult fixture date (`2000-01-01`) to all affected integration registrations.
  Commit `00aee63` (`Update integration fixtures for student birth dates`) was pushed to the
  branch and `main`.
- GitHub Actions run `33425808918` progressed further: 34 notification checks passed and two
  class-creation checks failed with `403 EMAIL_UNVERIFIED`. The application was correctly
  enforcing that a teacher cannot create a class before email verification, operator approval,
  and paid-plan access; the old test setup had silently assumed those gates were open.
- Added `scripts/test-support/teacherAccess.mjs`, a CI-only fixture helper that updates only the
  disposable integration database. Classroom/payment/notification suites now explicitly make
  their teacher fixtures email-verified, operator-approved, and active before testing unrelated
  behavior. Production registration and all application guards remain unchanged.
- The support-desk suite is intentionally different: only its ordinary class teacher is prepared.
  Its newly registered applicant remains pending so the operator review queue and approval flow
  continue to be tested honestly.
- Added the throwaway PostgreSQL URL at GitHub job scope because the earliest notification and
  board suites previously had no direct database setting. It points only to the CI service on
  `127.0.0.1`, never to Railway or production data.
- All modified integration scripts passed `node --check`; `git diff --check` passed. Full
  typecheck passed, app tests passed 154/154, API tests passed 269/269, and design lint stayed at
  223 hex literals / 429 raw font sizes with no regression.
- One restricted API-test attempt could not read the `jose` package through pnpm's Windows
  junction and reported a missing package. The junction and package existed; rerunning the same
  unchanged suite with approved junction access passed 269/269. No reinstall or dependency
  change was made for that sandbox-only failure.

### Deployment state at this checkpoint

- Both failed GitHub Actions runs stopped before the Cloudflare publish step, so neither one
  changed the production website.
- Railway watches `main` independently and may deploy the API commits before the matching web
  build reaches Cloudflare. The live API and website must therefore be checked together after a
  fully green GitHub run; do not infer a complete release from either service alone.
- The next action is to commit these CI fixture repairs, push the branch and `main`, monitor the
  complete workflow, then verify the Railway health endpoint and the public Cloudflare site.

### Third production attempt

- Commit `205498e` (`Repair gated teacher integration fixtures`) was pushed normally to both the
  Claude branch and `main`. GitHub Actions run `33446922968` proved the fixture repair: the two
  previously failing notification checks passed, as did board limits, both payment modes,
  reviews, refunds, date/subscribe rules, repeated alerts, storage uploads, and direct-message
  attachments.
- That run stopped later in the class-conversation attachment suite. Its single-class half
  passed completely. Its monthly half launched a child API process without `NODE_ENV=test`, so
  the server correctly refused to simulate a teacher-plan payment; the test then continued with
  an undefined class id and produced secondary `Invalid class id` failures. Cloudflare did not
  publish.
- Corrected the child test server to declare its isolated test runtime explicitly. Added a
  direct assertion for the teacher test-plan purchase and an immediate, diagnostic failure if
  monthly class creation ever fails again, preventing one root problem from turning into a page
  of misleading follow-on errors. No production payment behavior was changed.

### Fourth production attempt

- Commit `c1c33c2` (`Run class chat plan flow in test mode`) was pushed to the Claude branch and
  `main`. GitHub Actions run `33447252340` passed the repaired class-conversation suite and the
  video-provider swap, then reached the support-desk suite.
- The support-desk suite passed 48 checks and failed two when it tried to approve a new teacher
  who had no identity document. The application correctly returned `409`: an account may be
  approved only after its submitted documents have individually been opened and approved.
  Cloudflare did not publish.
- Updated the test to create a submitted citizenship-document fixture, open the applicant case
  through the real operator endpoint, approve the document through the real document-decision
  endpoint, and only then approve the teacher account. Storage upload mechanics remain covered
  separately by the upload suites; the support-desk fixture starts at the operator's inbox.

## Production gate stabilization and monthly-plan audit

This section records every subsequent production attempt, including CI/test-harness mistakes.
None of the failed runs below reached the Cloudflare publish step. They therefore did not replace
the production web bundle.

### Document review and CI resource failures

- Commit `672b946` (`Exercise document review before teacher approval`) implemented the honest
  support-desk fixture described above. Run `33447593707` then reached the workflow's overall
  time ceiling before the expanded gate could finish. Commit `e709133` raised that ceiling to
  60 minutes; it did not weaken or skip a test.
- Runs `33449231793`, `33449857495`, `33450430404`, `33450967566`, and `33451551574` exposed the
  GitHub runner's memory limit while Metro built the Excalidraw-heavy web bundle alongside API
  integration processes. Commits `8cd7545`, `55e47f7`, `218a55e`, and `892fc7c` progressively
  constrained Metro worker count and aggregate/Node heap use. These were CI-process changes;
  no classroom behavior or production memory setting was changed.
- Commit `1d23822` (`Isolate Metro from integration servers`) fixed the actual peak: build the
  disposable browser bundle before starting the integration APIs, then reuse it for the real
  browser journeys. Run `33465865635` passed the memory-heavy section and exposed the next real
  fixture mismatch instead of failing from resource exhaustion.

### Browser fixtures brought in line with real account gates

- Run `33465865635` showed that older browser signups omitted the now-required student date of
  birth. Commit `381f036` added explicit adult dates only to disposable browser accounts.
- Run `33466488851` showed that browser fixtures were redirected through email verification and
  onboarding before they could reach the unrelated screen under test. Commit `5bb715f` added a
  shared `scripts/test-support/accountAccess.mjs` helper that completes only those two gates in
  the throwaway CI database. Teacher approval and plan access remain opt-in per suite so tests
  cannot accidentally bypass the rules they are meant to exercise.
- Run `33467355042` passed notification, classroom, navigation and refund journeys. Its upload
  journey launched a private API without `NODE_ENV=test`, so the server correctly refused a
  simulated teacher-plan payment and no monthly homework class existed. The child process was
  corrected to declare test mode and the journey now asserts plan creation immediately.

### A product-rule omission found while repairing the fixtures

- Auditing that failure found that `POST /monthly/plan` did not call `mayBuyTeacherPlan`, even
  though class creation did. A new teacher could therefore try to buy the monthly tier before
  email verification and operator approval. Commit `ba919db` closes that application-layer gap;
  it does not alter the atomic charge/plan transaction.
- The monthly API suite now proves that an unverified teacher receives `EMAIL_UNVERIFIED`, a
  verified-but-pending teacher receives `OPERATOR_REVIEW`, neither refusal creates a plan row,
  and an eligible teacher can still buy the tier. The previously absent `test:monthly`,
  `test:portal`, and real `test:monthly-browser` suites were added to the production workflow.
- Run `33468475058` ran the newly gated monthly contract and exposed five time-dependent test
  fixtures. They scheduled make-ups at `Date.now() + N days`; in Kathmandu that happened to
  overlap the daily 09:00 class, so the server correctly refused them. Commit `97f18bf` uses
  distinct future days at a deterministic free 13:15 slot. This preserves both owner rules:
  make-ups may be at any day/time in the same cycle, but may not collide with the regular class.

### End-to-end monthly browser findings

- Run `33468954430` passed the full 193-check monthly API contract, monthly course portal, upload
  journey and calendar journey. The teacher-plan browser purchase failed because the earlier
  whiteboard-persistence test restarted the shared CI API without preserving `NODE_ENV=test`.
  The server therefore behaved like production and correctly refused a simulated teacher-plan
  charge. Commit `02b6a8e` preserves test mode across that restart.
- The same commit strengthened the browser journey to capture the actual payment response and
  require the class-setup form to become visible. This removed a false-positive text check that
  had said the screen moved on even when no plan row existed.
- Run `33470087632` proved the teacher payment (`HTTP 201`, plan row, visible setup form) and then
  timed out on the student's purchase. The cause was in the new diagnostic helper: it listened
  only for `/monthly/plan`, while a student correctly posts to
  `/monthly/classes/:id/join`. Commit `0c19b17` parameterizes the expected endpoint and asserts
  both server responses independently.
- Run `33471130805` passed both teacher and student monthly purchases, exact pro-rated price,
  enrolment, class setup, course chat visibility and homework. Its only failed assertion was an
  obsolete gesture expectation: long-press now opens the shared reactions/actions menu and Pin
  is a separate deliberate tap, but the journey never tapped the displayed Pin action.
- Commit `afc7ad7` now verifies both parts: hold the message until the actions appear, tap Pin,
  then confirm `pinned_at` persisted. The later student-visibility and homework checks already
  passed in the failed run, so this was the last observed browser blocker rather than a hidden
  cascade.

### A second clock-dependent control fixture

- Run `33500074221` passed install, typecheck, design/app/API rules and every integration gate
  through late-joiner chat. It stopped in the teacher-leave suite before reaching the browser
  journey. The two failed *allowed* controls kept `Date.now()`'s clock time when moving fourteen
  days forward; this run occurred just before the recurring 17:00 Nepal class, so their
  sixty-minute make-ups overlapped it. The server correctly returned `409` with
  `There is already a class at that time.` The leave refusal itself and the explicit collision
  refusal both passed.
- Commit `c2b76eb` schedules those control make-ups at 13:15 Nepal on their intended calendar
  days. Nepal's fixed UTC+05:45 offset makes the fixture deterministic. The regular class remains
  at 17:00, and no application collision, leave, make-up or billing rule was relaxed.

### Verification accounting

- Every pushed attempt ran a clean Linux install. Across the latest attempts, workspace
  typecheck, design ratchet, 269 API unit tests, 154 app unit tests, the monthly contract,
  monthly portal, uploads, notifications, reviews, refunds, support desk, operator access,
  video-provider seam, attendance, restart persistence and calendar journey all passed.
- Local Windows verification remains limited by OneDrive/pnpm junction visibility for `jose`,
  `expo-apple-authentication`, and `expo-auth-session`; clean Linux CI resolves and typechecks
  them. No dependency was removed or app code weakened to hide that local filesystem issue.
- `psql` is not installed in this Windows checkout, so PostgreSQL integration evidence comes
  from the workflow's isolated Postgres 16 service, never from Railway production data.
- Source release candidate `c2b76eb` and documentation commit `2663ac2` were pushed together.

### Successful production release

- GitHub Actions run `33500697922` completed successfully with all 53 workflow steps green.
  This includes clean install, full workspace typecheck, design ratchet, API/app unit tests, all
  integration suites, the corrected leave controls, the complete monthly API contract, the real
  browser journeys (including both monthly purchases and the two-step Pin action), desktop and
  phone whiteboard checks, phone-photo upload, slow-phone behavior, in-call chat, failed-call
  safety, production export, Cloudflare publish and the workflow's live-build confirmation.
- Independent verification after the workflow completed:
  - Railway `GET /api/healthz` returned HTTP 200 with `{"status":"ok"}`.
  - `https://hometuition.praksh-dhakal.workers.dev/` returned HTTP 200.
  - All three JavaScript assets referenced by production HTML returned HTTP 200. The production
    entry was `entry-4258192bef8986ccdaaeaf9173a1e3f7.js` (4,761,361 bytes) and contains both
    the Sikshya app identity and the correct Railway production origin.
  - A real browser rendered title `Sikshya`, redirected normally to `/welcome`, and showed both
    Teacher and Student role choices. Google, Facebook and Apple login controls remained hidden.
  - The browser recorded no runtime error. Its only warning was Expo's existing notice that push
    token-change listeners are not fully supported on web; this does not affect the in-app
    WebSocket notification channel covered by the browser suite.

### Newly observed but deliberately not changed in this release

- The production welcome page displays `5,000+ Teachers`, `50,000+ Students`, `Nepal's Premier
  Teaching Platform`, and `Nepal's best teachers`. No data source for those counts or
  superlatives was audited during this activation. They predate the email/monthly release and
  were not silently changed after the green deployment because that would require another full
  production cycle. Queue the welcome screen for the same fabricated-data audit used on the
  dashboard and Discover screens; until supported, those claims should be removed or replaced
  with honest product language.
