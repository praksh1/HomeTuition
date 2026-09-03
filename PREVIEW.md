# Previewing a branch before it goes live

A preview lets a change be *looked at* before it reaches students and teachers. Reviewing this app
means doing things — approving a document, granting test access, resetting a password — and every
one of those writes to a database and can send email. So a preview needs its own web app, its own
API, and its own data, with every outbound credential withheld.

| | Production — do not touch | Preview |
|---|---|---|
| Web app | `hometuition` Worker | `hometuition-preview` Worker |
| API | `workspaceapi-server-production-5a63.up.railway.app`, auto-deploys `main` | a second Railway service, deploying **the reviewed commit** |
| Data | the live Neon database | **a new, empty Neon database with synthetic accounts** |
| Email / payment / video / storage | live credentials | **withheld or stubbed** |

---

## Who does what

| | Responsibility |
|---|---|
| **Claude** | The repository: workflow, `wrangler.jsonc`, this document, and the exact variable **names** and non-secret values below. Never handles or asks for secret values. |
| **Codex** | Account-side work in the owner's signed-in browser — Railway, Neon, GitHub, Cloudflare — plus local commands such as `db:push`. Obtains any confirmation each action requires. |
| **Owner** | Product decisions and visual approval. Not expected to run commands, open dashboards, or configure services. |

Nothing in this document is a task for the owner.

---

## Why the workflow refuses instead of falling back

The first version defaulted to the production API. Withdrawn before it ever ran, because it was
wrong twice:

- **It could not do its job.** The production API deploys `main`. A branch's new endpoints are not
  on it, so a reviewer would test a new screen against an old server and learn nothing.
- **It would have edited live data.** Approving a test document on that preview would have approved
  a real teacher.

A preview that silently points at production is more dangerous than no preview, because it looks
safe. So the staging API must be named explicitly and the run stops if it is not. It also refuses
any URL that looks like production, anything containing `-production.` (Railway's default naming,
and so the likeliest accidental paste), and any `*.workers.dev` address, since the API is never a
Worker.

### There is already a frontend-only Worker, and it is not this

`https://claude-excalidraw-whiteboard-sync-gjoqaz-hometuition.praksh-dhakal.workers.dev/` was
deployed by hand with a pinned Wrangler. It is useful for looking at screens, but **it talks to the
production API**, so it is not an end-to-end preview and must not be used to exercise unmerged
server behaviour or any action that writes. Leave it in place; it is not managed by this workflow
and must not be deleted as part of this work.

---

## The data rule, which the first draft of this document got wrong

**Do not create the staging database as a Neon branch of production.** An earlier version of this
document said to, and then called the result empty. Both halves were wrong and the combination was
dangerous: a Neon branch is a **copy-on-write clone of the production data**, so it would arrive
carrying real users, real email addresses, real documents and real payment history — and a reviewer
told it was empty would treat that PII as disposable test data.

Staging uses **a new, empty Neon project or database**, populated only with synthetic accounts. No
production data is copied, sanitized, or exported. If a future need for realistic data appears, it
is a separate decision with its own review, not a step in a preview setup.

---

## What exists already, and what is missing

Checked 3 Sep 2026.

| Piece | State |
|---|---|
| Railway Hobby | **Active.** USD 5 compute warning, USD 10 workspace hard limit, Agent limit USD 0 — all saved and verified on 31 Aug |
| Brevo Free | Configured **on the production service**, one verified sender |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Present and working — deploy run `33500697922` succeeded 1 Sep, which it cannot do without them |
| `hometuition-preview` Worker | Defined in `wrangler.jsonc`; created on first deploy |
| Staging Railway service | **Missing** |
| Staging Neon database | **Missing** |
| `STAGING_API_URL` repository variable | **Missing** |
| Railway / Neon credentials in GitHub CI | **Absent, and to stay absent** unless separately authorized — a token that can deploy the API can deploy production |

### Spend

The USD 10 hard limit is a **workspace-wide emergency stop**: reaching it takes every Railway
workload offline, production included. A staging service draws on the same budget, so it should run
only while a review is in progress and be paused immediately afterwards.

No additional paid plan is authorized, and no limit may be raised.

---

## Codex checklist — account-side setup

Each step is a UI action in the owner's signed-in session. Secret values are read and entered inside
that session and never printed, pasted into chat, or committed.

### 1. Neon — a new empty database

- Create a **new project or database**, named so it cannot be mistaken for production
  (e.g. `sikshya-staging`).
- **Not a branch of the production project.** See the data rule above.
- Keep its connection string inside the session for step 2.

### 2. Railway — a staging API service

- New service from the `HomeTuition` GitHub repo, in the existing workspace so the saved limits
  still apply.
- Name it without the word "production" — e.g. `hometuition-api-staging`. The preview workflow
  rejects any URL containing `-production.`
- **Source branch: the branch under review** (`claude/excalidraw-whiteboard-sync-gjoqaz` for
  PR #10), **not `main`.** A staging API on `main` reproduces the original defect: new screens
  against an old server.
- Variables to **set**:

  | Name | Value |
  |---|---|
  | `DATABASE_URL` | the staging Neon connection string from step 1 |
  | `SESSION_SECRET` | a **new random value**, different from production, so a production token cannot sign in to staging or the reverse |
  | `NODE_ENV` | `production` |
  | `VIDEO_PROVIDER` | `echo` — the built-in stub, so no real Daily room is ever created |

- Variables to **leave unset**, deliberately. Each one is an outbound side effect:

  | Withheld | Effect of leaving it unset |
  |---|---|
  | `BREVO_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM` | `isEmailConfigured()` returns false, so **no email is sent to anyone** and the app says so rather than pretending |
  | `ESEWA_MERCHANT_ID`, `KHALTI_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET` | payments stay in **simulated** mode; no real charge is possible |
  | `DAILY_API_KEY`, `EXPO_PUBLIC_DAILY_DOMAIN` | no real video room is created |
  | `R2_*` (five names) | no write reaches production object storage |
  | `GOOGLE_*`, `FACEBOOK_*` | social sign-in reports itself disabled, as it already does in production |
  | `APP_URL`, `PUBLIC_APP_URL` | no links in outbound messages point anywhere real |

  Do **not** set `PORT`; Railway provides it.
  Do **not** set `ALLOW_TEST_TEACHING_ACCESS` yet — see step 4.

- **Settings → Networking → Generate Domain.** Record the address for step 3.

### 3. GitHub — point the workflow at staging

- **Settings → Secrets and variables → Actions → Variables** → new repository **variable**:
  - Name: `STAGING_API_URL`
  - Value: the Railway domain from step 2, with `https://`
- A variable rather than a secret on purpose: it is a public hostname, and keeping it readable means
  anyone can confirm at a glance that a preview is not aimed at production.

### 4. Schema, then synthetic accounts, then the flag — in that order

1. Run `pnpm run db:push` with the **staging** `DATABASE_URL`. This creates the tables in the empty
   database.
2. Create synthetic test accounts (`pnpm run seed`, or registering throwaway accounts through the
   preview). Never import production users.
3. Only now, if the test-access feature is being reviewed, add `ALLOW_TEST_TEACHING_ACCESS=true`
   **on the staging service only.**

   The order is not stylistic. Verified by experiment: flag off with the table missing, the app is
   fine — the code never queries it. Flag **on** with the table missing, the teacher dashboard
   returns **500**.

   | Table | Flag | Teacher dashboard |
   |---|---|---|
   | missing | unset | 200 |
   | missing | `true` | **500** |

   It must never be set on production, and must be off everywhere before launch with no live grants
   left.

### 5. Run the preview

GitHub → **Actions** → **Preview a branch** → **Run workflow** → choose the branch under review.

Leave `api_url` blank to use `STAGING_API_URL`. The run prints the preview address in its summary.

### 6. Afterwards — pause staging

Pause or remove the staging Railway service as soon as the review is finished, so it stops drawing
on the shared USD 10 limit that would otherwise take production down with it.

---

## What the owner is asked for

Only this: open the preview URL, look at the screens under review, and say whether they are right.

---

## What a preview still cannot tell you

- **Email, payments and video are off by design.** A flow that ends in "we sent you an email" can be
  reviewed up to that point and no further.
- **The data is synthetic**, so it will not reproduce a bug that depends on real records.
- **A green preview is not a green test suite.** The workflow typechecks and builds; it does not run
  the integration or browser suites.
- **The API is whatever the staging service last deployed.** If its source branch is not the branch
  under review, the preview is testing the wrong server.
