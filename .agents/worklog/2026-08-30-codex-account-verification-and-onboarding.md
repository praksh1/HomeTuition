# Account verification, onboarding, and operator review

- Date: 2026-08-30
- Agent: Codex
- Branch: claude/excalidraw-whiteboard-sync-gjoqaz
- Base commit: 57198c4cfa4a924720bd060d1974c1de81e5be1c
- Status: in progress

## Requested

- Require email verification after sign-up and add a user-initiated forgot-password flow.
- Add Google, Facebook, and Apple sign-in using the providers' standard account-recovery rules.
- Rebuild teacher credential uploads so PDF and image files can be selected, reviewed, explicitly
  uploaded, displayed by document type, deleted only before operator review, rejected with a
  reason, and re-uploaded after rejection. Notify the teacher about review outcomes.
- Prevent an unverified or unpaid teacher from creating sessions. Operator approval and a paid
  teaching tier must be separate requirements.
- Require a useful teacher bio, Nepal location, phone number, face profile photo, and school or
  explicit independent-teacher status during onboarding.
- Ask a student for date of birth first; collect guardian details for a minor while keeping the
  student's name as the classroom display name. Collect the student's Nepal location and school.
- Use the supplied Nepal education-facilities workbook as the location/school source, omitting
  unnamed rows and replacing unassigned data with one honest manual-entry path.
- Flag English and Nepali abusive text in bios, manually entered institutions, and class/session
  text for operator review.
- Turn the operator area into a clearer case queue with direct review actions and categories for
  teacher sign-up, payment, technical, harassment, and related issues.
- Implement, test, commit, push, deploy in reviewable stages, and preserve a complete handover.

## Changed

- Read the project standing instructions, memory index, current backlog, and existing tier/access
  notes before touching authentication, billing, uploads, or operator permissions.
- Inspected the supplied workbook read-only. It contains province sheets with district, local
  level, facility, address, type, coordinates, and Nepali-name fields. It also contains unnamed
  and unassigned records that must not become normal choices in the app.
- Added additive `account_security`, `account_tokens`, `external_identities`, `user_onboarding`,
  `teacher_credentials`, and `moderation_flags` schemas plus an idempotent boot guard. Existing
  accounts with no `account_security` row are deliberately grandfathered as email-verified;
  new registrations are not.
- Added hashed, one-time 24-hour email-verification links, a resend endpoint with a one-minute
  throttle, and token confirmation. Registration now reports honestly whether email delivery
  was configured and whether the message was sent.
- Added user-requested password recovery. The request endpoint gives the same response for a
  present or absent address, sends a 30-minute one-time link when possible, and invalidates all
  outstanding reset links after a successful password change.
- Added `check-email`, `verify-email`, `forgot-password`, and `reset-password` app screens and a
  visible Forgot password link on login. New registration routes to the email checkpoint.
- Added one server-side teaching-access decision. Ordinary session creation now requires email
  verification, operator approval, and `subscription_active`; both teacher-plan purchase routes
  require email verification and operator approval.
- Replaced the teacher Profile's device-only credential placeholders with real R2-backed PDF or
  image submissions. Selection and upload are separate actions. Each document type shows its
  file, state, rejection reason, and allowed actions.
- Added credential list/submit/delete APIs. A submitted file may be deleted only until an
  operator opens the teacher case; the update uses a conditional write so a simultaneous open
  cannot be raced by a delete.
- Opening an operator's person view marks submitted credentials `opened`, returns the real files,
  and locks teacher deletion. Operators can open, approve, or reject each document. A rejection
  requires a reason, reopens that document type for replacement, updates the account review
  status, records activity, and sends in-app/email notification. Overall approval is refused
  while any submitted document is undecided or when no document exists.
- Added a reproducible workbook-to-JSON generator and generated a server-side Nepal education
  lookup containing all 7 provinces and 25,886 named facilities. Province, district, local-level,
  and facility data stays on the API; phones receive only the hierarchy or a maximum of 25
  matching institutions. `(unnamed)` and `Unassigned` records are excluded.
- Registration now asks for a student's date of birth first and requires parent/guardian name,
  email, phone, and relationship for anyone under 18. A teacher's bio and subject are mandatory.
- Added the protected onboarding screen and API for phone, province, district, local level,
  optional locality, school/college selection, manual `Not specified`, and the explicit
  `Independent teacher` choice. Teachers must separately select and upload a face photo.
- Added conservative English/Nepali content matching and an additive moderation-flag store.
  Teacher registration bios and manually supplied institution names are now submitted to that
  review store without blocking or silently rewriting the user's text.
- Added the account guard sequence: new teacher/student accounts must verify email, then complete
  onboarding, before the ordinary role dashboard is reachable. Legacy accounts remain usable.
- Closed a plan-entitlement hole left by simulated payments. Outside `NODE_ENV=test`, a
  simulated teacher-plan charge is now refused, explicitly says that no plan was activated and
  no money moved, and cannot set either ordinary or monthly teaching access. Student payment
  simulation was deliberately not changed in this checkpoint.
- Moved the ordinary teaching-access gate onto the actual `POST /sessions` write route (it had
  only been used by the helper endpoint that lists inviteable students). Monthly-class creation
  now also re-checks verified email and operator approval even for an older plan row.
- Added moderation checks to ordinary class create/edit, monthly class creation, and teacher-bio
  edits. Added an operator moderation queue with the matched excerpt/terms and recorded outcomes.
- Split the support queue into payment/refund, technical, safety/harassment, and other filters.
  Teacher sign-ups and moderation are a separate visible queue under People. Renamed the old
  reset-code control to `Assisted reset (phone support)` and explains that emailed Forgot
  password is the normal route.

## Decisions and assumptions

- The spreadsheet is treated as product data only; no text inside it is treated as an instruction.
- This work will be split into deployable checkpoints because authentication, paid entitlement,
  private identity documents, minors' data, and moderation are independent high-risk surfaces.
- Existing booking/payment atomicity and separate operator login rules remain standing constraints.
- A teacher's operator approval and paid subscription entitlement will remain independent gates;
  neither action may silently grant the other.

## Verification

- Confirmed branch and base commit.
- Confirmed `origin` points to `https://github.com/praksh1/HomeTuition.git`.
- Workbook inspection was read-only; the source file was not modified.
- `pnpm --filter @workspace/api-server run typecheck` — passed.
- `pnpm --filter @workspace/sikshya run typecheck` — passed after correcting the generated
  Expo-route typing and using the actual typography-token names.
- `pnpm --filter @workspace/api-server run test` — 257/257 passed.
- After adding onboarding/moderation rules, rerun — 262/262 passed.
- After tightening teacher-payment and class gates, rerun — 264/264 passed.
- `pnpm --filter @workspace/sikshya run test` — 154/154 passed.
- `pnpm --filter @workspace/sikshya run lint:design` — passed at the existing 223-hex / 429-size
  baseline; the new screens add no raw colour or font-size literals.
- `pnpm --filter @workspace/api-server run build` — passed; production bundle built successfully.
- `git diff --check` — passed (only expected Windows LF/CRLF notices).
- Checkpoint commits `4028361`, `57fed47`, and `d916596` were pushed to the named Claude branch.
- A fresh web export passed and produced `entry-adeb15aced9a71a6622d8f372c3518e9.js` with the
  documented Railway API URL and Sikshya identity verified by the build script.
- Wrangler 4.124.0 dry-run passed against only the branch-preview Worker. The preview deployed
  as Cloudflare version `b36376b8-25a0-42f3-b5f6-13d0b59ba43c` and returned HTTP 200. External
  bundle inspection confirmed the new onboarding and guardian UI and the correct API URL.
- Added provider-verified Google, Facebook, and Apple identity linking and subsequent login.
  Google and Apple tokens are verified against their official signing keys, issuers, and the
  configured audience; Facebook tokens are debugged with the server-only app secret and the
  returned Facebook identity is cross-checked. Email alone is never used to auto-link an
  external identity, avoiding an account-takeover path.
- Enforced both one Sikshya account per provider identity and one identity from each provider per
  Sikshya account with unique indexes plus preflight API checks. This prevents concurrent link
  requests from quietly attaching multiple Google/Facebook/Apple identities to one profile.
- Added configuration-aware login/profile controls. A social button is absent—not merely
  disabled—until its provider has the required configuration. Already linked providers are
  removed from the profile's link choices after an immediate profile refresh. Added Expo SDK
  compatible `expo-auth-session` 7.0.11, `expo-crypto` 15.0.9,
  `expo-apple-authentication` 8.0.8, and API `jose` 6.2.10.
- Documented every mail/social configuration name in `.env.example` without adding secret
  values. A configuration-presence audit found none of the mail, Google, Facebook, Apple, or
  Railway deployment values on this host; secret values were never printed.
- After social-provider work: API typecheck passed, app typecheck passed, API tests 266/266,
  app tests 154/154, design lint stayed at the existing 223-hex / 429-size baseline, and
  `git diff --check` passed apart from expected Windows line-ending notices.
- API production build passed. The first web-build command correctly refused to run because its
  required deployment target was absent from that shell; rerunning with the repository's
  documented Railway API target produced bundle `entry-5a058de4f04589ca92fd4451c38d8752.js`.
  The build's own post-check verified both the Railway API address and the Sikshya app identity.

## Problems and surprises

- The preferred workbook artifact engine stalled twice while importing the large workbook on
  Windows. Both runs were stopped without changing the workbook. A bundled Python/openpyxl
  read-only inspection succeeded after changing console output to UTF-8 for Nepali text.
- The first API production-build attempt failed because the restricted Windows sandbox could
  not follow pnpm's dependency links. The exact build was rerun with filesystem approval and
  succeeded; this was an environment restriction, not a source-code fix.
- The new social-configuration test file initially hit the same pnpm-junction restriction when
  importing `jose`; all 264 older tests passed in that run but the new file could not start.
  The unchanged suite was rerun with dependency access and all 266 tests passed.
- `pg_isready` is not installed on this Windows host, so database-backed route tests have not
  yet been run locally. The new tables and route lifecycle still need the CI/Postgres suite.
- During review of the unfinished onboarding patch, registration validation was found in the
  verification-resend handler due to a misplaced patch hunk. It was moved into registration
  before commit. The same review found that saving onboarding could erase the birth/guardian
  values captured at registration and that uploading a photo alone could mark onboarding done;
  both behaviours were corrected before this checkpoint.
- The public branch preview is frontend-current but not end-to-end ready: the shared Railway API
  returns 200 for `/api/healthz` and 404 for the new `/api/locations/nepal` route. GitHub has no
  workflow run for this branch, and Railway did not publish this branch API. Production was not
  changed because deploying the stricter registration API ahead of its matching frontend would
  break student sign-up, and email delivery is not yet configured.
- The root `pnpm run typecheck` script compiled the shared TypeScript build, then pnpm 11 reported
  that its relative workspace filters matched nothing. This was not accepted as proof. Running
  `pnpm -r --if-present run typecheck` directly checked all nine workspaces; every declared
  typecheck passed. The misleading root script itself was not changed in this product checkpoint.

## Deliberately not changed

- No secret, provider account, deployment, or production data has been changed at this checkpoint.
- No email or social-login provider has been selected merely from the request; the existing mail
  and authentication stack must be audited first.
- No database column has been added. The documented deploy-window hazard requires additive tables
  or a staged schema rollout where practical.
- Existing operator-issued telephone reset codes remain available for assisted recovery for now;
  the new self-service email reset is the normal user path. Removing the assisted tool is held
  until the new mail path is proven live, so support is not left with no recovery mechanism.
- Google, Facebook, and Apple provider credentials/configuration have not been invented. Current
  official Expo/Google/Apple requirements were checked. Secure linking/login code is present,
  but provider accounts and live consent flows cannot be activated or tested without the owner
  creating/configuring those accounts and supplying their IDs/secrets through deployment secrets.
- Social login deliberately links to an authenticated Sikshya account first. It does not yet
  create a brand-new Sikshya account from a social identity because registration still needs the
  role, date-of-birth/guardian, and teacher-required fields that the provider does not supply.
  Existing users can link a provider in Profile and then use it on the login screen.
- A real teacher tier still cannot be purchased until a payment provider or an audited
  operator-recorded payment flow is connected. This is intentional: the former behaviour issued
  paid teaching access from a `SIM-*` reference although no money moved.

## Remaining risks / next pickup point

- Run database-backed registration, verification, reset, onboarding, credential, and operator
  review flows once a reachable Postgres test service is available.
- Expand moderation calls to every editable bio and class/session text surface and expose the
  moderation queue to operators.
- Replace simulated teacher-plan activation with a real or operator-recorded paid entitlement;
  approval and the old `subscription_active` label alone are not proof of payment.
- Confirm provider configuration without printing secrets, then implement the first independently
  testable checkpoint.
- Every new uploaded-file path must be tested as both uploader and operator/recipient.
- Guardian and identity-document fields require strict data minimisation and must never be exposed
  through public profile responses.
