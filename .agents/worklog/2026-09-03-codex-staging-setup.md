# Isolated staging API and preview-safety review

- Date: 2026-09-03
- Agent: Codex, with Claude correcting PR #11 and an independent read-only audit
- Product branch deployed to staging: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Product commit deployed to staging: `bc0aa17`
- Preview-infrastructure branch: `claude/preview-infrastructure`
- Status: staging API healthy; preview-infrastructure corrections ready for commit; PR #11 remains unmerged

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
