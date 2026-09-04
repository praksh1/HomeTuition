# Isolated staging API and preview-safety review

- Date: 2026-09-03
- Agent: Codex, with Claude correcting PR #11 and an independent read-only audit
- Product branch deployed to staging: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Product commit deployed to staging: `bc0aa17`
- Preview-infrastructure branch: `claude/preview-infrastructure`
- Integration branch: `codex/staging-preview-integration` (merge commit `f908870`)
- Status: complete for isolated preview infrastructure; document/approval/classroom product review remains open; production unchanged

The first sections below preserve the initial checkpoint. The continuation at the end supersedes
its old "not yet" statements and pickup list.

## Requested

The owner authorized Codex to lead the work while Claude worked alongside it. The immediate scope
was the previously confirmed Claude correction and an isolated Railway staging service backed by a
new Neon staging database. Production was not to be used for branch review.

## Changed

### Account-side staging infrastructure

- Created a new, empty Neon project named **Sikshya Staging** (`odd-glitter-76212521`). It is a
  separate PostgreSQL 18 project in AWS US East 2, not a branch or copy of Paathshala production.
- Created Railway service **hometuition-api-staging** (`cc10a94f-b24b-47bc-ae5c-ec2a9307cfa0`)
  inside the existing Hobby workspace so the saved workspace spending limit still applies.
- Connected only `praksh1/HomeTuition` branch
  `claude/excalidraw-whiteboard-sync-gjoqaz`.
- Added exactly four service variables: `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`,
  and `VIDEO_PROVIDER=echo`. The service uses zero of the five production shared variables.
- Deliberately withheld email, payment, Daily, storage, social-login, and public-link credentials.
- Added `pnpm run db:push` as Railway's pre-deploy command. This created the schema in the empty
  staging database without using the destructive bulk seed.
- Added Railway health check `/api/healthz`; the initial deploy completed successfully.
- Generated public staging API domain
  `https://hometuition-api-staging-production.up.railway.app`. The final `-production` is Railway's
  environment suffix, not the service's purpose; the service itself is isolated staging.
- Added public GitHub repository variable `STAGING_API_URL` with that staging hostname.

### PR #11 review and correction

Claude completed commit `11e7683`, which correctly made exhausted retries fail, added a pre-build
API probe, documented the default-branch requirement, removed `pnpm run seed`, and added several
missing withheld variables.

Codex and an independent audit then found remaining gaps and corrected them locally:

- the per-run API field can no longer redirect a run to an arbitrary host; it may only match the
  reviewed `STAGING_API_URL` allowlist;
- trailing slashes are normalized;
- the generated Railway staging hostname is allowed even though Railway appends the environment
  name `production`; known production and Worker hosts remain blocked;
- both Cloudflare token and account ID are checked before setup/build;
- `/api/healthz` must return both HTTP 200 and the expected healthy body;
- the remote check now requires this build's fingerprinted JavaScript asset, verifies that it
  contains the staging API URL, and refuses the production API host;
- the withheld list now includes `GOOGLE_CLIENT_IDS` and `PUBLIC_APP_URL`;
- the fixture instructions now deploy the preview before registering through it, state that
  email-disabled accounts need staging-only verification, and describe the real two-row operator
  model instead of saying to promote one registration.

## Decisions

- No Neon branch of production and no production data copy.
- No production shared Railway variables, even when the Railway UI offered an **Add All** shortcut.
- No Brevo, payment gateway, Daily, R2, Google, Facebook, or Apple credentials in staging.
- `VIDEO_PROVIDER=echo` keeps branch review free of Daily usage and room creation.
- Railway serverless sleeping remains off while classroom/WebSocket behaviour is under review; the
  service will instead be paused after the owner's review.
- PR #11 was not merged. Its workflow cannot run until it is on the default branch, and merging to
  `main` would also trigger the production web workflow. That requires a separate reviewed decision.
- No synthetic accounts or test-entitlement flag yet. Schema and API health came first.

## Verification

| Check                            | Result                                                                 |
| -------------------------------- | ---------------------------------------------------------------------- |
| Neon isolation                   | separate project `odd-glitter-76212521`; no production copy            |
| Railway source branch            | `claude/excalidraw-whiteboard-sync-gjoqaz`                             |
| Railway deployed commit          | active deployment message matches `bc0aa17`                            |
| Railway service variables        | exactly four; zero production shared variables in use                  |
| Schema command                   | saved as `["pnpm run db:push"]`; deployment succeeded                  |
| Railway health check             | `/api/healthz` saved                                                   |
| Public API probe                 | HTTP 200, body `{"status":"ok"}`                                       |
| GitHub variable                  | `STAGING_API_URL` set to the staging Railway domain                    |
| Workflow/Markdown parse          | Prettier parsed and formatted both files                               |
| API, app, and scripts typechecks | passed after allowing pnpm junction access outside the command sandbox |
| `git diff --check`               | clean before worklog addition                                          |

## Problems and what went wrong

- Railway's **Details** review unexpectedly displayed staged secret values instead of masking them.
  Nothing had deployed. Codex immediately reset the Neon role password, replaced Railway's
  `DATABASE_URL`, generated a new `SESSION_SECRET`, and verified only variable names thereafter.
  Both displayed values were invalid before the first deployment.
- The first UI entries for pre-deploy and health check looked filled but were not saved. Railway
  required its explicit **Save** button. The staged review exposed this (`[]` for pre-deploy), and
  both settings were re-entered, saved, and verified before deployment.
- Railway generated a staging service hostname ending in `-production.up.railway.app` because the
  service lives inside its environment named `production`. The earlier heuristic would have
  rejected this genuinely isolated host. The workflow now uses one exact reviewed allowlist and
  separately blocks the known production host.
- The in-app browser blocked direct navigation to the Railway health endpoint. A read-only
  PowerShell request outside the network sandbox returned the expected 200 response.
- Workspace typechecks initially reported missing packages because the command sandbox could not
  follow pnpm's junctions. Re-running the same checks with junction access passed; this was an
  environment limitation, not a source-code defect.
- Claude's second correction was materially better but still omitted two environment names and
  described an impossible fixture order. Codex did not approve it blindly.

## Deliberately not changed

- Production Railway service, variables, database, deployment, and public site.
- Production Neon project or any production row.
- Railway workspace spending limits.
- Brevo or any other third-party production credential.
- `ALLOW_TEST_TEACHING_ACCESS`; it remains absent until schema and controlled fixtures exist.
- The destructive `pnpm run seed` script was not run or modified.
- PR #10 product code was not changed during infrastructure setup.
- PR #11 was not merged and the Cloudflare preview Worker was not yet redeployed in this entry.

## Remaining risks and next pickup point

1. Finish verification, commit, and push the Codex correction on PR #11.
2. Decide how to place the workflow on `main` without surprising the owner with an unrelated
   production web redeploy; do not merge silently.
3. Deploy the preview Worker against the new staging API, then create only a few named synthetic
   accounts. No production data and no bulk seed.
4. Bootstrap one staging-only operator with both the `users` and `operator_accounts` rows, and mark
   only named synthetic registrations email-verified because outbound email is disabled.
5. Add `ALLOW_TEST_TEACHING_ACCESS=true` only after the schema and fixtures are verified.
6. Give the owner the HTTPS preview link for visual review. Pause the Railway staging service after
   that review to protect the shared USD 10 hard limit.

## Continuation — isolated preview and controlled fixtures

### Requested and approved

- Owner resumed work and requested efficient use of usage.
- Explicit follow-up approval: create exactly three synthetic staging accounts, verify only their
  test emails, and enable staging-only operator-granted teaching access.
- Further explicit approval: investigate/configure a separate staging R2 upload bucket under the
  existing free allowance. No new paid plan and no production bucket/key reuse.

### Changed

- PR #11 correction was already committed/pushed as `5d0e00f`; no PR was merged into main.
- Created integration branch from product `bc0aa17`, merged infrastructure `5d0e00f`, yielding
  `f908870`. `git diff bc0aa17 HEAD -- artifacts lib` was empty before adding infrastructure checks.
- Built with `EXPO_NO_DOTENV=1`, explicit staging API, two Metro workers and 2048 MB Node heap.
- Published ONLY Worker `hometuition-preview` using pinned Wrangler 4.124.0 and `--env preview`.
- Live preview: https://hometuition-preview.praksh-dhakal.workers.dev
- Cloudflare version: `d7094446-252b-486b-98e4-e235027bd05f`.
- Added `scripts/verify-preview.mjs` and seven tests. Verification reads the actual script paths
  from the generated HTML, compares served HTML references and SHA-256 bytes of every initial
  script, requires the staging API, and refuses the known production API. This handles split
  Metro runtime/common/entry output instead of assuming one `index-*.js` file.
- Updated preview workflow to run the verifier/tests. Corrected PREVIEW.md's claim that all setup
  needs a main merge and its obsolete Railway hostname rejection rule.
- Added staging `ALLOW_TEST_TEACHING_ACCESS=true` only after confirming the grant table exists.
- Added staging `PUBLIC_APP_URL` equal to the isolated preview. Absent PUBLIC_APP_URL actually
  falls back to production in accountSecurity.ts; withheld email credentials prevent delivery,
  but absence is NOT a safe link-origin control. Documentation corrected.
- Railway redeployment with these two additions succeeded:
  `39e46902-cb50-463a-ac88-c86cbf07b6dc`. Six service variables; no shared production variables.

### Fixture details and limitations

- Before fixtures, Neon SQL proved `users` count zero and both `operator_accounts` and
  `test_teaching_grants` present in separate project `odd-glitter-76212521`.
- Registered teacher through the actual preview UI: ID 1, `staging.teacher.20260903@example.com`.
- Created student ID 2, `staging.student.20260903@example.com`, and operator ID 3,
  `staging.operator.20260903@example.com`, with a small targeted SQL transaction (not bulk seed).
- Operator has its real `operator_accounts` row, login ID `staging-review`,
  `is_administrator=false`; its bootstrap credential is a final test credential, so
  `must_change_password=false`. It cannot create other operators.
- The three disposable fixtures share one cryptographically generated test password, kept in the
  browser automation session, never emitted, committed, or put in this log. The student/operator
  bootstrap copied the teacher's existing salted hash inside SQL without retrieving it. Do not
  reuse this convenience for real accounts. Credentials must be independently re-established or
  fixtures recreated if the browser automation session disappears.
- Verified email only for those three exact fixture identities. Gave teacher/student clearly
  synthetic onboarding rows with completed_at so disabled R2 does not block unrelated plan review.
  No real face, phone number, school affiliation, or identity document was invented. Student DOB
  is the synthetic adult date 2000-01-01. This is NOT evidence that onboarding/upload works.
- Teacher remains pending. No document acceptance, account approval, paid subscription, session,
  booking or teaching grant was fabricated. Exactly three users were verified by SQL after commit.
- Operator sign-in was tested through the app's existing email login, not the separate
  `/operator/login` API. Do not claim the dedicated operator-ID UI was tested.

### Verification actually performed

- Named workspace typechecks passed: shared libraries, API, app and scripts. Root wildcard
  selection is unreliable on Windows, so explicit filters were used.
- App unit tests: 154 passed. API unit tests: 280 passed. Preview verifier: seven passed.
- Design ratchet passed unchanged: 223 hex / 429 raw font sizes across 57 files.
- Web build completed; dry run passed; local generated files contained staging and no production
  API hostname. Live HTML and all three startup JS bundles matched local bytes exactly.
- Browser rendered welcome, teacher signup/check-email, teacher dashboard/subscription, operator
  support queue, People and teacher detail.
- Unapproved teacher: all five tiers disabled; eSewa/Khalti and payment disabled; explanatory
  approval message present before payment.
- Operator People queue: synthetic teacher has Approve/Review controls and opens correct detail.
  Detail says no identity document submitted; test access requires approved account + verified email.
- Clicked approval with no documents; no successful approval was observed. Browser tooling did
  not expose the notification dialog, so this is NOT claimed as a fully verified UI refusal.
- Railway usage UI: $0.17 compute used, $10 shared compute cap, $0 agent cap. Limits not changed.

### Problems and surprises

- Initial local preflight correctly stopped before deploy because the old fingerprint regex
  expected `index-*.js`; the real export has `__expo-metro-runtime`, `__common`, and `entry`.
  Replaced the same faulty assumption in CI with tested multi-bundle verification.
- Expo printed very large existing Excalidraw CSS local-resource warnings. Build nevertheless
  completed. No claim that native fonts/rendering were verified.
- AX setValue did not populate email/password inputs reliably. Used browser Playwright fill with
  observed placeholders, checked registration outcome, and never printed password values.
- Teacher signup needs an explicit subject selection. First submit was refused until Mathematics
  was chosen; it did not create a duplicate account.
- New finding: check-email rendered "We sent a verification link" on email-disabled staging.
  AuthGuard can route without delivery params; CheckEmail defaults unknown params to success.
  Registration API correctly reports delivery false. Product fix still required.
- Claude native UI is unavailable in the current tool surface. Its existing web code-session link
  redirected to sign-in. No fresh instruction was sent and no new Claude work was assumed.

### Fabrications found

- Reconfirmed the already-tracked welcome claims (5,000+ teachers, 50,000+ students, 77 districts)
  and the misleading login demo-account hint on this empty deployment.
- Newly reproduced unsupported email-sent claim described above. Left product source unchanged
  during infrastructure verification; these are queued fixes, not silently declared complete.

### Deliberately not changed / remaining work

- No main merge, production deployment, production data, shared secrets, spending-limit changes,
  paid-service activation, or video-provider replacement. Daily remains production; echo is staging.
- No real mail/payment/video test. Reset-token expiry/reuse and device touch behavior remain
  unverified in this public staging run. Passing unit tests are not those manual tests.
- Staging upload setup is next, then real synthetic-file upload/review, test grant, and a synthetic
  teacher/student class. Never bypass missing document approval just to make the test green.
- Owner review still pending. Pause Railway staging when review ends; cap is shared with production.

### Upload-setup checkpoint

- Read the R2 skill configuration and current Cloudflare pricing/authentication docs. Standard R2
  includes 10 GB-month, 1 million Class A and 10 million Class B operations per month; this is a
  shared allowance, not a separate free allowance for each bucket. Infrequent Access is excluded.
  Source: https://developers.cloudflare.com/r2/pricing/ (checked 3 Sep 2026).
- `wrangler@4.124.0 r2 bucket list` succeeded and showed only existing `hometuition-uploads`.
  No bucket was created, no production object was read/changed, and no token was issued yet.
- Cloudflare dashboard is signed out. CLI OAuth still permits deployments, but it is not a
  substitute for dashboard sign-in to inspect usage and issue a narrowly scoped S3 credential.
  Asked owner to sign in; never requested their password or codes.
- Next storage step after sign-in: inspect account usage, create a distinct Standard staging
  bucket, restrict new Object Read & Write credentials to that bucket, keep public access off,
  allow CORS only from the isolated preview, store keys only in staging Railway, verify upload.
  Do not enable a new paid plan, reuse the production key, or claim setup succeeded before this.

### Saved handoff checkpoint

- Commit `53e3f7e` pushed successfully to `origin/codex/staging-preview-integration`; branch tracks
  its own remote, not the product branch. Worktree clean immediately after push.
- Final staging health probe after the variable redeploy: HTTP 200, `{"status":"ok"}`.
- Synthetic student sign-in and Discover rendered successfully. No approved teacher is listed;
  pending teacher ID 1 is correctly excluded. This is a real empty state, not missing fixtures.
- Owner opened Cloudflare login through GitHub. Last observed page was GitHub two-factor/passkey
  authentication; completion is for the owner. No passkey, password or one-time code was handled.
- No staging R2 bucket/token exists yet. Do not repeat DB/service/preview setup on resume.
- Next agent should read `.agents/backlog/2026-09-03-preview-smoke-followups.md` for the exact
  bounded Claude prompt and unverified flows. Claude web is not signed in, so prompt is prepared,
  not sent. The desktop/native surface is unavailable in the current toolset.

### Upload setup resumed after owner sign-in

- Owner completed Cloudflare sign-in in a NEW browser tab; the old tab remained at GitHub passkey
  authentication. Inventory located the signed-in tab without repeating authentication.
- R2 dashboard before creation: 9.49 MB, 11 objects, 35 Class A / 64 Class B operations, $0.00
  billable. No new paid plan was activated.
- Created `sikshya-staging-uploads`, Standard storage, `enam` location hint, with no Worker binding
  changes. Production bucket `hometuition-uploads` was untouched.
- Applied `scripts/staging-r2-cors.json` only to staging. It allows the exact preview origin,
  GET/PUT/HEAD, content/x-amz headers, exposes ETag and caches preflight for one hour. CLI readback
  matched; live OPTIONS returned HTTP 204 with the correct origin/methods. Unsigned S3 GET returned
  400, not content. No public/custom-domain access was enabled.
- Issued USER token `Sikshya staging uploads 2026-09-03`, Object Read & Write on ONLY the staging
  bucket. No admin or production-bucket rights. TTL widget was not exposed; no expiry was set or
  claimed. Revoke this testing key after the staging review is retired.
- Kept one-time values in browser automation memory and printed only redacted labels. Saved both
  key fields in staging Railway, plus R2_BUCKET and R2_ACCOUNT_ID; ten service variables, zero
  production shared variables. Never opened Railway Details with staged secret edits.
- A safety check stopped navigation away from the one-time key page before secure persistence.
  Saved both fields in Railway first, then navigated away successfully. No credential was lost,
  exposed or stored in Git, and the rejected action was not bypassed.
- Storage redeployment `80925eca-3abf-44e1-a014-8e788d7ecceb` became ACTIVE / successful.
- First storage diagnostic refused authorization because the student test had replaced the
  origin-wide saved token while another tab still displayed the operator UI. This is a shared
  browser-session test limitation; re-sign into the operator before testing operator actions.
  Do not test concurrent teacher/student roles in tabs sharing the same local storage.

### Final verified storage checkpoint

- Re-authenticated the synthetic operator after the student test and ran Check file uploads.
  It reported: a file can be written, read back and deleted in `sikshya-staging-uploads`.
  R2_ENDPOINT is intentionally absent: the app resolves the correct endpoint from R2_ACCOUNT_ID.
- CLI bucket info after diagnostic: ENAM, Standard, zero objects, zero bytes. Only the diagnostic
  test object was removed; no user document or production object was deleted.
- Re-ran the live preview verifier after storage redeploy; HTML and all three JS bundles still
  match the tested build. No frontend rebuild was needed for server-only storage configuration.
- Current totals: 154 app + 280 API + seven verifier tests passed; named workspace typechecks and
  design ratchet passed. No real video, emailed reset flow, document review, teaching grant or
  two-device classroom touch test is being claimed as passed.
- Infrastructure is now available for those next tests. Claude's exact scoped next task remains
  in the smoke-followups backlog; its browser still needs sign-in. This is not a product launch
  approval, main merge or permission to put production credentials in staging.
- Final environment: ten staging variables, private isolated R2 with bucket-restricted object key,
  echo video, mail/payment/social keys absent, test-access flag on but zero grants, pending teacher.
- Two documentation patches failed exact-context checks and wrote nothing; corrected the patch
  context and applied successfully. No source or deployed runtime was affected.

### Email-verification truth integration

- Owner asked Codex to lead and keep Claude on non-overlapping bounded work. After the computer-use
  action-time confirmation, Codex sent Claude only the check-email messaging task. Claude completed
  `claude/verification-message-truth` at `6eca5ba`; no Claude deployment or main merge occurred.
- Codex reviewed the six-file diff and cherry-picked it into this integration branch as `ee446c7`.
  The screen now distinguishes unknown delivery, unconfigured mail, configured send failure,
  provider-accepted send and already-verified resend. AuthGuard passes the email address but does
  not invent delivery state; the resend UI reads the 200 response body rather than treating every
  successful HTTP status as proof another email was sent.
- Independent checks after integration: 168 app tests passed, 280 API tests passed, all named
  workspace typechecks passed and design ratchet remained 223 hex / 429 sizes across 57 files.
  The staging web export completed with EXPO_NO_DOTENV=1 and the explicit isolated Railway API.
- Claude rendered the four initial route states at 390 px and reported 14 browser assertions, but
  did not use the public isolated preview. Codex has not yet claimed the authenticated resend cases
  as rendered; already-verified and failed resend remain unit-only until the rebuilt preview is
  deployed and checked.
- Claude's older `claude/slice5-shape-recognition-wip` at `c908d7f` is not safe to merge: relative
  to product `bc0aa17` it carries unrelated preview workflow/wrangler changes and deletes part of
  an earlier worklog. A clean shape-recognition branch is required; do not cherry-pick that WIP.

### Email-verification preview deployment

- Rebuilt the Expo web export with the explicit isolated API, after all 168 app tests, 280 API
  tests, named workspace typechecks and the design ratchet passed. Dry-run read 242 assets and
  found no bindings. Direct bundle inspection found the staging API and no known production host.
- Deployed ONLY `hometuition-preview` with `wrangler@4.124.0 deploy --env preview`. Cloudflare
  version: `d1ee552f-a0e1-4e3b-beea-63e45b893e00`. Production Worker remains untouched.
- Post-deploy verifier passed: live HTML and all three initial script bundles exactly match the
  tested local export and use the staging API.
- A browser tab already held the synthetic operator token. Both a normal and requested named
  browser session shared the same origin storage and AuthGuard redirected `/check-email` back to
  operator Support, so Codex did not log the operator out or pretend it had rendered the route.
  The saved fixture passwords no longer exist in this browser runtime. The live authenticated
  resend outcomes therefore remain unverified; Claude's 390 px initial-state renders remain the
  only rendered evidence for this slice.
- Codex then completed two separate, documented one-file truth cleanups: welcome at `900097d`
  removes unsupported user/district counts and all of that screen's 18 hex/10 raw sizes; login at
  `38212e0` removes fabricated demo credentials. Tests/typechecks/design checks pass and the design
  baseline is now 205 hex/418 sizes. These two later commits are deliberately NOT in the current
  live bundle yet; one future build will batch them with the clean reviewed shape-recognition fix.

### Truth cleanups and automatic-shape removal preview

- That planned batch is now live only on staging. It includes the welcome truth cleanup
  (`900097d`), login demo-hint cleanup (`38212e0`), and the clean automatic-shape-removal slice
  integrated as `a918f51`; it does not use contaminated Claude WIP `c908d7f`.
- Before deployment, all four named workspace typechecks passed, app tests passed 170/170, design
  lint passed at 205 hex/418 sizes, the staging web export passed, the rendered whiteboard suite
  passed 44/44, and the standalone 6× CPU slowdown performance run reported no blockers. The
  initial parallel performance run failed two scene-load assertions under resource contention;
  the serialized rerun passed and the failure was retained in the shape worklog.
- Pushed integration through `73c561f`. Deployed ONLY `hometuition-preview` with pinned Wrangler
  4.124.0 and `--env preview`; Cloudflare version is
  `b55ff7d6-3a71-49ae-8215-878b3eba1f14`. Production Worker and main branch were untouched.
- Live verifier passed: public HTML and all three initial bundles byte-match the local build,
  include the isolated staging API, and exclude the known production API. Staging
  `/api/healthz` returned HTTP 200 and `{"status":"ok"}`.
- Owner manual verification remains required before any production integration. In particular,
  draw handwriting plus rough lines/circles and confirm they remain ink, then use explicit
  Excalidraw rectangle/arrow tools. This deployment does not claim a real Daily call or a
  simultaneous two-device classroom test.

### Preview-account access recovery

- The owner correctly reported that the isolated preview was not practically testable: production
  accounts are intentionally absent, staging mail is intentionally unconfigured, and the original
  random fixture password had existed only in an earlier browser-automation runtime. The earlier
  wording that called the preview ready did not make this access limitation clear enough.
- Used the still-authenticated synthetic operator session to issue normal one-use, 30-minute
  assisted-reset codes for only the three documented staging users. Redeemed those codes against
  the isolated Railway API and assigned one new shared preview password. The password was given to
  the owner in chat and is deliberately not written to Git, this worklog, browser password storage,
  or an environment file.
- Verified all three credentials through the real staging `/api/auth/login` endpoint without
  printing tokens: teacher returned `role=teacher`, student returned `role=student`, operator
  returned `role=admin`; all three returned `emailVerified=true`. Teacher and student onboarding
  are complete. The operator has no student/teacher onboarding by design.
- A verified email alone did not let the teacher create classes: the real server correctly still
  required a reviewed document, approved account, and either paid plan or explicit test grant.
  Uploaded one existing app icon to the private staging bucket as a clearly named **synthetic
  review document**, submitted it as `professional_certificate`, opened and approved that exact
  staging document, approved only the synthetic teacher, then granted seven days of Base test
  teaching access with an audit reason stating that no payment was recorded. The grant expires
  automatically on 2026-09-11 UTC.
- No production identity document, user, database, bucket, payment, email key, plan, or permission
  changed. The staging server still has no mail credential. Existing production users should not
  work on the preview, and a brand-new staging signup still cannot self-verify until staging mail
  is configured. The recovered fixtures are the immediate manual-testing path.
- Brevo's existing free-plan account was inspected read-only. Its production key remains active.
  A separate key form is prepared with the name `Sikshya Staging API`, but the key has **not** been
  generated or saved to Railway; creation requires the owner's action-time confirmation. No key
  value was viewed, copied, logged, or committed.
- Claude Web was reachable and signed in. A fresh task is prepared for a separate Stream Video
  provider proof-of-concept, but no prompt has been transmitted yet; sending it also awaits the
  required action-time confirmation. Codex owns staging access/email/deployment, so the proposed
  Claude task must stay on its own branch and must not touch the current integration branch,
  production provider choice, payments, or deployments.
