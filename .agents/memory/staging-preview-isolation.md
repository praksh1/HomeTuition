# Isolated preview checkpoint — 2026-09-03

Owner approved Codex/Claude coordination, Railway staging, three synthetic staging accounts,
staging-only verified test emails/test teaching access, and a separate staging upload bucket under
the existing free allowance. No new paid plan, production data copy, production storage reuse,
or main merge is authorized by these approvals.

- Review URL: https://hometuition-preview.praksh-dhakal.workers.dev
- API: https://hometuition-api-staging-production.up.railway.app
- Railway staging service: `cc10a94f-b24b-47bc-ae5c-ec2a9307cfa0`.
- Neon: NEW project `odd-glitter-76212521` (Sikshya Staging), not a branch of live Paathshala.
- Product: `bc0aa17`, branch `claude/excalidraw-whiteboard-sync-gjoqaz` (PR #10).
- Preview infra: PR #11, `claude/preview-infrastructure`, `5d0e00f` before integration corrections.
- Integration: `codex/staging-preview-integration`, merge `f908870` plus the verifier/doc commits.
- Cloudflare version: `d7094446-252b-486b-98e4-e235027bd05f`.

Do not confuse the older long Claude-branch Worker with this preview: that older frontend points
at production. Do not use it to test writes. The new preview has its own API and database.

`--env preview` permits a manual deployment WITHOUT merging a GitHub workflow into main.
`EXPO_NO_DOTENV=1` avoids accidental local env loading. Use `scripts/verify-preview.mjs` after
deploy; this Expo export uses multiple runtime/common/entry bundles, not `index-*.js`.

Payment/Daily credentials remain absent. Staging email is now configured with its own Brevo key and
the existing verified sender; it is not the production key. Railway deployment
`0fc81119-d31e-4429-89e5-490eccf22c95` succeeded. A synthetic reset was accepted by Brevo and then
hard-bounced at the deliberately fake `example.com` recipient, so provider connectivity is proven
but real inbox delivery and verification-link completion are not. Rotate the staging key after
review because its one-time value appeared in the private automation transcript; never copy it
into Git. Separately authorized staging storage uses
`sikshya-staging-uploads` and a bucket-restricted key, never production credentials. Its CORS
allows only the preview. Echo is not a real video test. PUBLIC_APP_URL is
explicitly staging: absence otherwise falls back to the live site. The test-access table was
verified before the flag was enabled. The synthetic teacher is now document-reviewed and approved,
with a seven-day Base test-access grant expiring automatically on 2026-09-11 UTC. This is not a paid
plan. The three fixture passwords were deliberately re-established outside Git so the owner can
enter the preview; never copy the password into documentation or environment files.

Railway's $10 cap is shared with production, not a staging allowance. Last checked usage $0.17.
Pause staging after owner review. Do not raise the cap or add a paid plan.

Full audit trail, fixture limitations and current blockers:
`../worklog/2026-09-03-codex-staging-setup.md`. Read its continuation, not just initial checkpoint.
