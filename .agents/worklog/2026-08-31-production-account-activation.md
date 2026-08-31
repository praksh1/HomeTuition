# Production account activation — Codex worklog

Date: 2026-08-31
Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`

## Owner request

Guide and perform the production activation for email verification, password recovery, and
social login. The owner authorized Railway access but explicitly prohibited paid third-party
services for this activation.

## Production audit

- Opened the owner's existing signed-in Railway dashboard read-only.
- Project `HomeTuition`, production environment, service `@workspace/api-server` is online at
  `workspaceapi-server-production-5a63.up.railway.app`.
- Railway source is `praksh1/HomeTuition`, connected to `main` with automatic deployments. This
  is why pushes to the Claude branch update neither the production API nor the production site.
- The active API deployment is the main-branch merge of pull request 9, not the current Claude
  branch.
- Railway currently shows a trial with `3 days or $3.69 left` and a prompt to choose a plan.
  No plan, billing method, or purchase was selected or changed.
- Audited variable names without reading or printing secret values. The API has database,
  session, Daily, and R2 variables. It has no email, Google, Facebook, or Apple variables.

## Cost and provider findings

- Cloudflare Email Sending is currently a public beta available on the Workers paid plan. It was
  not enabled because that violates the owner's no-paid-service instruction.
- Apple lists Sign in with Apple as an Apple Developer Program capability; that program is
  USD 99/year. Apple login remains implemented but hidden and unconfigured.
- Resend has a USD 0 tier (3,000/month, 100/day) but requires a privately owned sending domain.
  The existing `workers.dev` hostname is a shared platform domain, not a DNS zone the owner can
  verify as a sender.
- Brevo's published free tier is USD 0, has no time limit or card requirement, provides
  transactional email/API access, and allows 300 sends/day. This is the selected experiment path.

## Code changes

- Extended the existing mailer to support Brevo's REST API through `BREVO_API_KEY` plus
  `EMAIL_FROM`, without adding an SDK dependency.
- Preserved Resend compatibility and gives an existing Resend configuration priority during a
  staged migration, so adding Brevo cannot silently switch a configured deployment.
- Brevo requests use its required `api-key` header, structured sender/to objects, and both plain
  text and optional HTML bodies. API keys are never placed in request bodies or logs.
- Added three mailer tests: incomplete configuration remains honestly unavailable; Brevo uses
  the correct endpoint/shape without leaking its key; existing Resend configuration keeps
  priority.
- Added `BREVO_API_KEY` to `.env.example` without any value.

## Verification

- First verification run found two test-harness defects: TypeScript over-narrowed a variable
  assigned inside mocked fetch, and Node strip-types could not resolve the mailer's extensionless
  logger import. All 266 existing tests passed in that run. Both harness issues were corrected.
- API typecheck passed.
- API tests passed: 269/269.
- No real email was sent because no Brevo account/API key/sender has been created yet.

## Deliberately not done

- Did not merge to `main`, change Railway's connected branch, redeploy production, or change the
  production frontend. Deploying the stricter API before working email is proven would strand
  every new registrant at verification.
- Did not purchase or enable Railway, Cloudflare Email Sending, Apple Developer, or any other
  paid plan.
- Did not create an email/social provider account or persistent API/OAuth credential on the
  owner's behalf without the required account verification and action-time confirmation.
- Did not expose, copy, or record existing Railway secret values.

## Next safe production sequence

1. Owner creates and verifies a free Brevo account and sender identity.
2. Create a restricted Brevo SMTP/API key, then add `BREVO_API_KEY`, `EMAIL_FROM`, and
   `PUBLIC_APP_URL` to Railway without exposing the key in Git or chat.
3. Commit/push this mailer checkpoint, deploy the branch API only when mail can be exercised,
   and send a real verification and password-reset email to an address controlled by the owner.
4. Only after end-to-end mail passes, merge the matching API and frontend to `main` and deploy
   the production Worker.
5. Configure Google, then Facebook, as separate free checkpoints. Keep Apple disabled until the
   owner independently chooses to pay for Apple Developer membership.
