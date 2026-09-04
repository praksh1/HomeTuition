# Put the controlled test journey on the main website

- Date: 2026-09-04
- Agent: Codex, coordinating Claude's reviewed release candidate
- Branch: `main` for the release; `codex/production-release-log` for this record
- Base commit: `2663ac2`
- Status: complete, with owner device verification still required

## Requested

Put the reviewed changes on the ordinary Sikshya website, preserve real Daily and the real payment
path, let the owner test without paying through narrowly granted test accounts, keep Claude and
Codex synchronized, and document every material action. Purchases were expressly excluded.

## Changed

- Verified `origin/claude/production-test-release-candidate` was a strict fast-forward from
  production and moved `main` from `2663ac2` to `999fe3b`.
- Pushed `main`; Railway auto-deployed the API and GitHub Actions deployed the Cloudflare Worker.
- Created `test_student_grants` and `test_classes` in the production Neon database before the API
  deployment. Verified both tables and the student lookup index exist.
- Enabled `ALLOW_TEST_TEACHING_ACCESS=true` and `ALLOW_TEST_STUDENT_ACCESS=true` on the Railway
  production service.
- Diagnosed and repaired the missing production `test_teaching_grants` table after the live
  operator record exposed it; no existing database object was dropped or altered.
- Granted the owner-selected teacher and student seven days of narrowly scoped production test
  access through the audited operator routes.
- Completed the legacy seeded student's missing onboarding through the ordinary authenticated
  onboarding API using clearly synthetic test-account details, after the server correctly refused
  the first grant attempt.
- Added this release state to durable memory on a documentation-only branch so writing the account
  does not cause a second production deployment.

## Decisions and assumptions

- No teacher or student grant was invented from an email guess. The owner explicitly chose
  `praksh.temp@gmail.com` and `student@sikshya.np`; both grants were applied through the operator
  screen.
- No direct SQL grant will be used: it would bypass eligibility checks, activity logging and the
  user notification performed by the API routes.
- The public payment path remains active. Only the intersection of two live grants and a
  test-marked class bypasses payment.
- Documentation was isolated from `main` because a docs-only main commit would retrigger the full
  production build after the successful release.

## Verification

- Release candidate before push: API unit **294/294**, app unit **213/213**, package-specific
  TypeScript checks passed, design ratchet unchanged at **205 hex / 418 sizes**, and
  `git diff --check` clean.
- GitHub workflow `33889966505`: **success**. It passed compilation, design/server/app rules,
  notification, payment, booking/refund, attachment, video-provider, support, monthly-class,
  attendance, whiteboard persistence, browser, phone-width, slow-phone, in-call chat and failed-call
  stages, then deployed and confirmed the live site.
- Railway production dashboard: deployment ACTIVE / successful.
- Production API: `GET /api/healthz` returned HTTP 200 and `{"status":"ok"}`.
- Production web: HTTP 200 and new bundle
  `_expo/static/js/web/entry-da308df1a79efb1e2a688f67e07be405.js`.

## Problems and surprises

- The first local API unit run failed one test because the sandbox could not follow pnpm's Windows
  junction to `jose`. The same suite run outside that filesystem restriction passed 294/294.
- Root `pnpm run typecheck` printed “No projects matched” for its recursive filters in this Windows
  checkout. API, app and scripts were therefore checked package by package and passed.
- Railway CLI 5.49.1 installed successfully but its session was unauthorized. The already signed-in
  Railway dashboard was used instead; no credential was exposed.
- The first Railway variable attempt used `ALLOW_TEST_TEACHER_ACCESS`, which is not the name read by
  the code. It was found immediately by checking the source, deleted, and replaced with
  `ALLOW_TEST_TEACHING_ACCESS`; the corrected deployment became ACTIVE.
- A health check first used `/health` and returned 404. The route is `/api/healthz`; that endpoint
  returned 200. The 404 was a path mistake, not an outage.
- Safe Windows automation could read Claude's finished release-candidate report but could not raise
  the Claude app for a new delegated prompt after the required recovery attempt. No text was sent
  to another window by guesswork.
- The release preparation had created `test_student_grants` and `test_classes`, but the handoff
  incorrectly claimed `test_teaching_grants` already existed. The first live teacher-detail request
  failed. Railway logs gave the exact missing-relation error; the table and index were created in a
  transaction, and the same record then loaded normally.
- The first live student grant was rejected with the exact intended safeguard: “This student has
  not finished onboarding. Test access does not skip that.” A read-only Neon query confirmed user
  706 had no onboarding row. Because this is the repository's seeded demo account (with its known
  seed login and substantial prior test activity), it completed the supported onboarding endpoint
  with explicit test details. The audited grant then succeeded.

## Fabrications found

None in this release operation. The release candidate itself contains the earlier truthfulness
fixes documented in `2026-09-04-claude-production-test-release-candidate.md`.

## Deliberately not changed

- No purchase, plan, billing setting, payment key or payment mode.
- No Daily provider configuration and no Stream POC merge (`8550631` remains isolated).
- No existing production column or payment record was modified. One onboarding row was created for
  the selected seeded student through the normal application API; two short-lived grant rows were
  created through operator APIs.
- No test account password was changed and no production grant was chosen by guessing an email.
- No manual Cloudflare deploy after GitHub Actions succeeded.

## Remaining risks / next pickup point

- Teacher user 719 has base test-teaching access until 11 Sep 2026, 1:30 PM. Student user 706 has
  test-booking access until 11 Sep 2026, 1:38 PM. Both are visible in the production operator UI.
- On the main website, the teacher creates a class; confirm it is marked test-enabled. The granted
  student books it without a payment form, then both devices join the real Daily room.
- Manually verify laptop, iPhone and Android: Excalidraw tools, stroke fidelity, resize/hide/restore
  call window, remote teacher video, screen share, chat unread indicator, attachments and leave.
- Before public launch, turn both test-access switches off. Do not delete grant rows.
