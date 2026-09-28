# Teacher studio, class journey, discovery and messages — Preview

- Date: 2026-09-28
- Agent: Codex (root with class-creation, class-navigation and inbox/discovery agents)
- Branch: `codex/support-case-workspace`
- Base commit: `0960532`
- Status: committed, deployed to Preview, and verified; not promoted to Production
- Code commit: `915cc7f` (pushed to `origin/codex/support-case-workspace`)
- Staging API deployment: `5e8da651-3500-455f-a846-2a9602763eb4` on `hometuition-api-staging`
- Preview Worker version: `fb9048cf-62a1-429a-8e9a-647c8b5ffc44` on `hometuition-preview`

## Requested

Fix the teacher class-creation timetable, conflict links, publish/discard loop and unpublished deletion; improve class-home dates and teacher class organization; make earnings and notifications clearer; prioritize student Discover results; modernize message avatars, report and blocking; check app speed. Review the owner's three screen recordings and four screenshots.

## Changed

- Teacher earnings overview and receipts now present recorded rupee amounts without visible commission percentages. Receipts can expand actual per-lesson allocations. Simulated tax remains explicitly test-only; no live tax charge was invented.
- The recorded Fadko fee has an accessible, expandable rupee allocation for platform, video/server, and maintenance, following the owner's NPR 210 example (NPR 154 + 42 + 14). It always adds to the one recorded fee and explicitly says it is not extra deductions or measured vendor expenses.
- Class Home now expands all upcoming dates and has a separate previous-lesson list. Teacher Home earnings opens the actual earnings page, the lesson's Class Home link is easier to see, and My Classes groups active/open/past/draft/closed with a clearer details action.
- The class wizard places lesson count and total price at the start, offers exact-count recurrence choices, focuses the selected conflict editor, reconciles lost create/publish responses, and permits deletion only of a never-published, unbooked draft. API refuses deletion of booked, formerly published, or enrolled classes.
- Notification counts use parentheses. Direct messages show signed avatars to authorized participants, silently suppress blocked senders' later messages and reactions from the recipient while retaining records, and offer a short private report that reaches an operator queue. Discover personalization ranks current enrolments, followed teachers, coarse subject/grade/district matches, then newest, with a rank-aware page cursor.

## Decisions and assumptions

- The platform/server/maintenance split is presentation allocation of the already recorded Fadko fee, not actual provider spending or three separate charges. There is no live tax formula yet.
- Deployment target is the isolated Preview Worker and staging Railway API, not Production.

## Verification

- Reviewed temporary contact sheets extracted from all three recordings. The recordings reproduced a long timetable, a stale-review publish loop, retained saved data after Leave without saving, and overlap edit controls that required scrolling.
- Teacher earnings browser suite after fee disclosure: 42 checks passed at 390px and 1440px. Receipt arithmetic unit suite: 8 passed.
- Class-home browser suite: 38/38 at 390px and 1440px after correcting a screenshot-found completed/cancelled classification defect; helper and contract unit tests: 17/17.
- Teacher class-list browser suite: 10/10 at 390px and 1440px; dashboard navigation: 33/33. Class wizard browser suite: 129/129 at 360px, 390px and 1440px, including retry/discard/delete cases.
- Final workspace typecheck passed, app design lint passed, API unit suite 797/797 passed, app unit suite 589/589 passed, API bundle compiled, and `git diff --check` passed. A stale class-price test expectation was corrected after the first combined run.
- Final browser reruns passed: class wizard 129/129, class home 38/38, teaching billing 42/42, teacher class list 10/10, dashboard 33/33, notifications 40/40, messages 148/148, Discover 250/250. These cover phone and laptop widths, with the wizard also at 360px.
- Staging API `/api/healthz` returned HTTP 200 `{"status":"ok"}`. Railway CLI showed the linked `hometuition-api-staging` service online.
- After the new deployment, Railway reported SUCCESS; `/api/healthz` again returned HTTP 200. Public `/api/programs?limit=1&presentation=class&personalized=1` returned HTTP 200, one result and a page cursor.
- The Preview web build used `EXPO_NO_DOTENV=1` and the exact staging API URL. Its assets contained that URL and no production API URL. Wrangler Preview dry-run and deploy succeeded; `verify-preview.mjs` verified served HTML and three exact bundles against the staging API.

## Problems and surprises

- Native/browser computer-use helper failed to initialize, so recordings were inspected via temporary FFmpeg contact sheets rather than live UI playback.
- The Chrome DevTools MCP required by the web-performance skill is not configured. No speed trace or quantified speed claim is possible in this run.

## Fabrications found

- A rendered test state labelled completed and cancelled lessons as Upcoming and called a completed lesson current. The status-aware classifier was corrected before release.
- Local direct-message DB integration could not start because the local Postgres test database on port 55432 was unavailable. A source contract and policy unit check cover suppression, but the route has not been exercised against a real database in this run.

## Deliberately not changed

- Production Worker and API; real payment configuration; automatic refunds or bans; private ID information.
- Existing untracked `.ux-audit/`, `artifacts/sikshya/.ux-audit/`, and `artifacts/sikshya/operator-web-build/` remain user-owned and untouched.

## Remaining risks / next pickup point

- The owner can now test the Preview flows on phone and laptop. Do not promote to Production from these mock-browser checks alone. Authenticated Discover ranking, blocked-message suppression and draft deletion still need a controlled end-to-end pass using synthetic Preview accounts; local PostgreSQL was unavailable, and no staging test writes were made in this release run. A source-level review corrected the class-list delete race by returning full rows in one query. A speed claim requires a browser trace once Chrome DevTools MCP is available.
