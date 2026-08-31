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
