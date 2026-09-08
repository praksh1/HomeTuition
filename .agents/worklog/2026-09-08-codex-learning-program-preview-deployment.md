# Learning Program preview deployment — 2026-09-08

## Outcome

The Learning Program teacher studio is now testable end to end on the isolated preview stack:

- Web: `https://hometuition-preview.praksh-dhakal.workers.dev`
- API: `https://hometuition-api-staging-production.up.railway.app`
- Railway service: `hometuition-api-staging`
- Source branch: `claude/learning-program-phase2`
- Deployed branch head shown by Railway: the commit whose subject begins `Deploy the program studio to the preview...`

Production web, production API, production data, payments, and provider configuration were not changed.

## What Codex changed in Railway

The staging API service was still connected to `claude/excalidraw-whiteboard-sync-gjoqaz`. Codex changed only the staging service source branch to `claude/learning-program-phase2` and redeployed it.

During the pre-deploy review, Codex found that this staging service was configured to run `pnpm run db:push` automatically. That contradicted the repository's deployment rules and would have made the deployment perform a broad schema synchronization. Codex removed the pre-deploy command before applying the branch change. The Railway confirmation dialog contained exactly these two changes:

1. source branch: `claude/excalidraw-whiteboard-sync-gjoqaz` -> `claude/learning-program-phase2`;
2. pre-deploy command: `["pnpm run db:push"]` -> empty.

No manual migration or `db:push` was run. The feature's two additive tables are created by its bounded startup guard, as reviewed in Phase 1.

## Verification performed

- Railway reported the new staging deployment as **Active** and **Deployment successful** after its configured `/api/healthz` health check.
- A separate public request to `/api/healthz` returned HTTP 200 with `{"status":"ok"}`.
- A separate public request to `/api/learning-programs/templates` returned HTTP 200 and all five expected templates: school subject, practical skill, language, exam preparation, and custom.
- Railway showed the previous staging deployment being removed only after the new deployment became active.

## What was not done or not proven

- No production service was changed or deployed.
- No purchase, paid feature, new account, password change, payment, booking, or user approval was performed.
- Codex did not sign in as the staging teacher because the password is intentionally known only to the owner.
- Owner testing of form sign-in, browser Back/reload protection, drafting, publishing, revision, take-down, archive/restore, and deletion remains required.
- Programs are still teacher-side Phase 2A. Student discovery, enrolment, pricing, scheduling, and classroom integration do not exist yet and must not be presented as finished.

## Safe rollback

If this preview deployment proves defective, reconnect only the `hometuition-api-staging` Railway service to its prior branch. Do not restore the automatic `db:push` pre-deploy command. Production does not need a rollback because it was not touched.
