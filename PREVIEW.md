# Previewing a branch before it goes live

A preview lets a change be _looked at_ before it reaches students and teachers. Reviewing this app
means doing things — approving a document, granting test access, resetting a password — and every
one of those writes to a database and can send email. So a preview needs its own web app, its own
API, and its own data, with every outbound credential withheld.

|                                   | Production — do not touch                                                 | Preview                                                     |
| --------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Web app                           | `hometuition` Worker                                                      | `hometuition-preview` Worker                                |
| API                               | `workspaceapi-server-production-5a63.up.railway.app`, auto-deploys `main` | a second Railway service, deploying **the reviewed commit** |
| Data                              | the live Neon database                                                    | **a new, empty Neon database with synthetic accounts**      |
| Email / payment / video / storage | live credentials                                                          | **withheld or stubbed**                                     |

---

## Before any of this works: PR #11 must be merged

GitHub only offers a `workflow_dispatch` workflow once the file exists on the **default branch**.
While `preview.yml` lives only on `claude/preview-infrastructure`, **"Preview a branch" does not
appear in the Actions list and cannot be triggered** — the API returns 404 for a dispatch.

So the order is: review and merge PR #11 first, then the manual workflow becomes available for
every branch afterwards, including the branch in PR #10 that it exists to review.

Nothing in this document can be exercised before that merge. Do not read the sections below as
"available now".

---

## Who does what

|            | Responsibility                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Claude** | The repository: workflow, `wrangler.jsonc`, this document, and the exact variable **names** and non-secret values below. Never handles or asks for secret values.              |
| **Codex**  | Account-side work in the owner's signed-in browser — Railway, Neon, GitHub, Cloudflare — plus local commands such as `db:push`. Obtains any confirmation each action requires. |
| **Owner**  | Product decisions and visual approval. Not expected to run commands, open dashboards, or configure services.                                                                   |

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
safe. So the staging API must be named explicitly in the reviewed `STAGING_API_URL` repository
variable and the run stops if it is not. The per-run field can only confirm that exact value; it
cannot redirect a run to a different host. Known production and `*.workers.dev` addresses are also
refused. Railway-generated domains include the Railway environment name, so the allowlist is the
control rather than guessing from a `-production` substring.

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

| Piece                                           | State                                                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Railway Hobby                                   | **Active.** USD 5 compute warning, USD 10 workspace hard limit, Agent limit USD 0 — all saved and verified on 31 Aug             |
| Brevo Free                                      | Configured **on the production service**, one verified sender                                                                    |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Present and working — deploy run `33500697922` succeeded 1 Sep, which it cannot do without them                                  |
| `hometuition-preview` Worker                    | Defined in `wrangler.jsonc`; created on first deploy                                                                             |
| Staging Railway service                         | **Healthy.** `hometuition-api-staging`, pinned to the PR #10 branch; four service variables and zero production shared variables |
| Staging Neon database                           | **Created.** Separate `Sikshya Staging` project; empty before schema creation and never copied from production                   |
| `STAGING_API_URL` repository variable           | **Set** to the staging Railway domain                                                                                            |
| Railway / Neon credentials in GitHub CI         | **Absent, and to stay absent** unless separately authorized — a token that can deploy the API can deploy production              |

### Spend

The USD 10 hard limit is a **workspace-wide emergency stop**: reaching it takes every Railway
workload offline, production included. A staging service draws on the same budget, so it should run
only while a review is in progress and be paused immediately afterwards.

No additional paid plan is authorized, and no limit may be raised.

---

## What the workflow can prove, and what it cannot

Worth stating plainly, because a green run is easy to mistake for a safety guarantee.

**It proves, automatically, on every run:**

| Check                                                 | How                                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| The API is the reviewed destination                   | it must equal the single `STAGING_API_URL` allowlist; a per-run override is refused                                               |
| The API is not a Cloudflare Worker                    | same guard — rejects any `*.workers.dev`, including the hand-deployed frontend-only branch Worker                                 |
| The staging API is actually answering                 | a `GET /api/healthz` that must return 200 with the expected healthy body before the build starts                                  |
| The built bundle does not contain the production host | a grep of `web-build` before upload                                                                                               |
| The new deployed preview really serves                | the exact fingerprinted bundle from this build must appear remotely, contain the staging API URL, and exclude the production host |

**It cannot prove any of these, and does not claim to:**

- **Which branch or commit the staging Railway service is running.** Nothing in the API reports its
  own commit — `/api/healthz` returns `{"status":"ok"}` and nothing else — and CI holds no Railway
  credential to ask. A staging service left on `main` would pass every check above while serving
  the wrong code.
- **That the staging database is separate from production.** The workflow never sees a connection
  string, by design.
- **That the outbound credentials are withheld.** Same reason. A staging service with a live
  `BREVO_API_KEY` would pass every check and email real people.

There is no repository-only assertion available for these three: each needs either a Railway
credential in CI, which is deliberately absent because a token that can deploy the API can deploy
production, or an API change to report its own commit and configuration. Adding a build-SHA field to
`/api/healthz` would make the first one checkable and is worth considering — as its own change, with
its own review, not as part of preview setup.

Until then they are verified by a person, before every run.

### Codex — mandatory verification before each preview run

Do these in the signed-in session and record the result. If any does not match, stop and correct it
before running the workflow; a preview built on a wrong answer is worse than none.

1. **Railway → the staging service → Deployments.** Confirm the _active_ deployment's **source
   branch and commit SHA** are the branch and commit under review. Not `main`, not an older commit
   of the right branch.
2. **Railway → the staging service → Variables.** Read the full list and confirm:
   - `DATABASE_URL` is the **staging** Neon database, not production;
   - `SESSION_SECRET` differs from production;
   - `VIDEO_PROVIDER` is `echo`;
   - **none** of the withheld names in the table above is present — check the whole list, not only
     the ones you set.
3. **Neon → projects.** Confirm the staging database is a **separate project or database**, not a
   branch of production, and that it holds only synthetic accounts.
4. **Railway → workspace usage.** Confirm current spend is within the saved USD 5 warning / USD 10
   hard limit before starting, since the limit stops production too.

After the review, pause the staging service.

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

  | Name             | Value                                                                                                             |
  | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
  | `DATABASE_URL`   | the staging Neon connection string from step 1                                                                    |
  | `SESSION_SECRET` | a **new random value**, different from production, so a production token cannot sign in to staging or the reverse |
  | `NODE_ENV`       | `production`                                                                                                      |
  | `VIDEO_PROVIDER` | `echo` — the built-in stub, so no real Daily room is ever created                                                 |

- Variables to **leave unset**, deliberately. Every name below was re-audited against the branch
  that staging will actually run (`artifacts/api-server/src` at the reviewed commit), and each
  effect was read in the source rather than assumed:

  | Withheld                                                                                        | Verified effect of leaving it unset                                                                                                  |
  | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
  | `BREVO_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`                                                 | `isEmailConfigured()` requires a provider key **and** `EMAIL_FROM`; without them it returns false and **no email is sent to anyone** |
  | `ESEWA_MERCHANT_ID`, `KHALTI_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET`                              | `paymentMode()` returns `gateway` if _any_ of these is set. With none, payments stay **simulated** and no real charge is possible    |
  | `DAILY_API_KEY`, `EXPO_PUBLIC_DAILY_DOMAIN`                                                     | no real Daily room is created                                                                                                        |
  | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ENDPOINT`         | no write reaches production object storage                                                                                           |
  | `GOOGLE_CLIENT_IDS`, `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID` | Google sign-in reports itself disabled                                                                                               |
  | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`                                                        | Facebook sign-in reports itself disabled                                                                                             |
  | **`APPLE_CLIENT_IDS`**                                                                          | `socialIdentity.ts` reports `apple.enabled: false`, and `verifySocialCredential("apple")` returns null before any token is checked   |
  | `APP_URL`, `PUBLIC_APP_URL`, **`EXPO_PUBLIC_DOMAIN`**                                           | notification and account-security links have no live-site base URL available                                                         |

  Names that are safe to set and are _not_ outbound: `LOG_LEVEL`, `WS_HEARTBEAT_MS`,
  `MODERATION_TERMS`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`. They change behaviour or
  tuning, not who gets contacted.

  Do **not** set `PORT`; Railway provides it.
  Do **not** set `ALLOW_TEST_TEACHING_ACCESS` yet — see step 4.

- **Settings → Networking → Generate Domain.** Record the address for step 3.

### 3. GitHub — point the workflow at staging

- **Settings → Secrets and variables → Actions → Variables** → new repository **variable**:
  - Name: `STAGING_API_URL`
  - Value: the Railway domain from step 2, with `https://`
- A variable rather than a secret on purpose: it is a public hostname, and keeping it readable means
  anyone can confirm at a glance that a preview is not aimed at production.

### 4. Schema, deployment, synthetic accounts, then the flag — in that order

1. Run `pnpm run db:push` with the **staging** `DATABASE_URL`. This creates the tables in the empty
   database.
2. Deploy the staging API and confirm `/api/healthz` returns the expected healthy response. Point
   `STAGING_API_URL` at it, merge the reviewed preview infrastructure, and run the preview workflow.
3. Only after the preview exists, create a handful of synthetic teacher and student accounts through
   its real registration screens. Because outbound email is deliberately disabled, Codex must mark
   only those named synthetic accounts email-verified in the staging database. Never relax the
   application-wide verification rule.
4. Bootstrap a separate synthetic operator using the supported two-row model: an `admin` user and
   its `operator_accounts` record. Merely changing a registered user's `role` is not sufficient.
   This account-side step must be recorded and must target the new Neon staging project only.

   **Do not run `pnpm run seed`.** It was read before being ruled out. `scripts/src/seed.ts` opens
   with six unconditional `DELETE FROM` statements — `reviews`, `session_enrollments`, `sessions`,
   `teacher_profiles`, `student_profiles`, `users` — with **no guard on which database it is
   pointed at**, so the wrong `DATABASE_URL` in the environment wipes that database's core tables.
   It then writes roughly 200 teachers, 500 students, thousands of randomised sessions and up to
   50 reviews for every approved teacher.

   Two reasons that is the wrong fixture here, beyond the risk: thousands of fabricated rows are
   not a reviewable state — a reviewer cannot tell a real defect from generated noise — and the
   script **creates no operator account at all**, so it cannot exercise the operator screens that
   PR #10 is largely about.

   No replacement fixture is proposed in this document. Inventing one is its own task with its own
   review; a few hand-registered accounts are enough to review a screen.

5. Only now, if the test-access feature is being reviewed, add `ALLOW_TEST_TEACHING_ACCESS=true`
   **on the staging service only.**

   The order is not stylistic. Verified by experiment: flag off with the table missing, the app is
   fine — the code never queries it. Flag **on** with the table missing, the teacher dashboard
   returns **500**.

   | Table   | Flag   | Teacher dashboard |
   | ------- | ------ | ----------------- |
   | missing | unset  | 200               |
   | missing | `true` | **500**           |

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
