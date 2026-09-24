# 24 September — separate classroom release and support investigation

## Request
Owner accepts classroom for production and defers four mobile/participant issues. Next priority: premium, free-first AI customer support with decision-ready payment/safety evidence and human-only refunds/bans.

## Production separation
Isolated release branch `codex/classroom-production-sep24`, main `c7b1017`, excludes paused AI-support commits. Production workflow `35960255605` is running; final deployment status must be verified, not assumed from a successful push. Four follow-ups recorded in that release's `.agents/backlog/2026-09-24-classroom-followups.md`.

## Support implementation
Branch `codex/support-investigation-sep24`, based on the accepted classroom/support Preview branch, not main. Adds history-aware bounded investigation, own-lesson selection/read-only facts, persisted lesson link, classified/source-separated human brief and reconnect/new-topic client race guards. Existing ticket session narrative is reused through the ticket's validated session link. Adds disabled-by-default Groq fallback behind plan/privacy gates and durable per-provider caps; Cloudflare remains primary.

## Verification so far
- 721 API unit tests passed locally before final follow-up assertions.
- 114 profile/support browser assertions passed at 390px and 1440px. Rendered screenshots inspected; no clipping in the tested context card and panel. Desktop Chromium at phone size is not physical Safari.
- API/app typechecks and design lint passed. The shared DB declaration needed rebuilding after the additive schema edit; first API typecheck correctly caught stale declarations, then passed after typecheck:libs.
- No local psql/docker command is available. Added a focused GitHub workflow using disposable Postgres with AI disabled and no cloud credentials; route/isolation checks pending that run.
- Provider requests in tests are mocks; no live AI answer-quality or vendor billing verification claimed.

## Limitations / next work
Full detail: `docs/FADKO-SUPPORT-FREE-FIRST-2026-09-24.md`. Vision, recording analysis, provider activation, payment reconciliation, operator case redesign and real end-user acceptance remain. No claims of reading the supplied videos. No automatic recording, account suspension, refund, paid plan, or external transmission of real customer evidence occurred.

## Skill influence
Cloudflare guidance required checking current quotas/pricing instead of assuming free use. Agent guidance kept conversation state durable and financial/moderation actions outside model authority; no unnecessary Agents SDK migration was introduced into the existing Express/Postgres service.
