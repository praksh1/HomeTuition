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
