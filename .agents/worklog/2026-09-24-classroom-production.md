# 24 September 2026 — accepted classroom production release

## Request and boundary
Owner accepted the current Preview classroom and authorized production. Record four remaining observations for later; prioritize AI support separately. No purchases. AI support production remains paused.

## Release assembly
- Fresh origin/main was `2832c36`.
- Isolated branch `codex/classroom-production-sep24` cherry-picks classroom commits `9ed878d` through `a36fb6c` in order.
- Excludes support commits `c069a56` through `cc31552`; merging the entire Preview branch would have launched unaccepted support work.
- Classroom application files match the accepted Preview source. Main's exact-port CI API cleanup is retained.
- No database schema changes, new provider keys, paid services, user account changes, real payments or refunds.

## Evidence
Accepted Preview workflow `35954798002` passed board 149/149, phone 18/18, real LiveKit 48/48 and full classroom 69/69. Prior worklog contains detailed evidence and limits. Production's own complete workflow must pass before claiming deployment.

## Deferred / not done
Four owner issues are in `.agents/backlog/2026-09-24-classroom-followups.md`. New videos have not been reviewed in this release pass. No physical-phone retest claimed. AI support improvements are not part of this production release.

## Release verification
Pending local checks and production workflow; append exact results after execution.
## Final verified outcome — 24 September 2026, 06:01 UTC

- Production source: `c7b1017bc3810683bc1d11897354fa57b5b2f2a0` on `main`.
- Full production workflow `35960255605` passed, including server-backed app, real call/floor, whiteboard, phone, photo, slow-phone and call-chat gates.
- Cloudflare deployment version: `3208b41e-f59d-41bb-a8be-cc89f3bd59f6`.
- Independently fetched live entry `_expo/static/js/web/entry-e91d84f9e4dc58cf2e559f6622895cbc.js`; it exactly matches the deployment log, uses only the production Railway API and serves title `Fadko`.
- Railway reports successful production API deployment for `c7b1017`; live `/api/readyz` returns `{"status":"ok"}` (includes a database query).
- The paused support branch was not merged into production. Live bundle does not include the new support investigation marker.
- Four classroom follow-ups remain deferred in `.agents/backlog/2026-09-24-classroom-followups.md`. This release does not claim they were fixed or that the supplied recordings were viewed.

## Separate support handoff

- Branch `codex/support-investigation-sep24`, source `db68eec`, pushed to GitHub.
- Final isolated workflow `35962237070` passed: 722 unit tests, 50 support API checks, 114 profile/support browser assertions, typecheck and design lint. Includes ownership isolation and concurrent message/handoff checks.
- Detailed implemented/not-implemented scope: `docs/FADKO-SUPPORT-FREE-FIRST-2026-09-24.md` on that branch.
- Adds bounded conversation investigation, selected own-lesson facts, durable context and a source-separated human review brief. Cloudflare-to-Groq fallback is implemented but disabled pending actual free-plan/privacy/age/region review and account configuration.
- Not yet deployed to Preview or production. No new provider account, purchase or paid fallback activated. No real customer evidence sent to a new provider.
- Next work: reviewed knowledge base and quality evaluation; staging API/frontend deployment together; payment reconciliation; secure evidence selection and image/recording analysis; operator case workspace. Human-only refunds and bans remain mandatory.
