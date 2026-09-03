# Previewing a branch before it goes live

A preview lets you *look* at a change before it reaches students and teachers. Reviewing this app
means doing things — approving a document, granting test access, resetting a password — and every
one of those writes to a database. So a preview needs three things of its own, and the third is the
one people forget:

| | Production | Preview |
|---|---|---|
| Web app | `hometuition` Worker | **`hometuition-preview` Worker** |
| API | Railway production service | **a second Railway service** |
| Database | the Neon database | **a separate Neon database or branch** |

**Only the first of those exists today.** The workflow refuses to run until you have made the other
two — see *What is missing* below.

---

## Why it refuses instead of falling back

The first version of this defaulted to the production API. It was withdrawn before it ever ran,
because it was wrong twice over:

- **It could not do its job.** The production API is built from `main`. A branch's new endpoints
  are not on it, so you would be testing a new screen against an old server and learning nothing.
- **It would have edited live data.** Approving a test document on that preview would have approved
  a real teacher.

A preview that silently points at production is more dangerous than no preview at all, because it
looks safe. So the rule is: **a staging API must be named explicitly, and the run stops if it is
not.** It also refuses a URL that looks like production, including anything containing
`-production.`, which is how Railway names a production service by default and therefore the
likeliest thing to be pasted in by mistake.

---

## What is missing, exactly

Checked on 3 Sep 2026:

| Piece | State | Who can create it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | **Present and working** — the deploy on 1 Sep (run 33500697922) succeeded, which it cannot do without them | already done |
| `hometuition-preview` Worker | Defined in `wrangler.jsonc`; created on first deploy | the workflow, automatically |
| **A staging Railway API service** | **Missing.** There is no Railway token in CI, so no workflow can create or deploy one | **the owner, in the Railway dashboard** |
| **A staging database** | **Missing.** No Neon credential in CI either | **the owner, in the Neon console** |
| `STAGING_API_URL` repository variable | **Missing** | the owner, once the Railway service has a domain |

This is why the preview cannot be finished automatically. Cloudflare is wired into CI; Railway and
Neon are not, and deliberately so — a token that can deploy the API is a token that can deploy
*production*.

### Before you start: cost

Railway Hobby includes **USD 5** of compute with a **USD 10** hard limit, and that limit is an
emergency stop for the whole workspace — *every* Railway service goes offline if the account
reaches it, including production. A second service draws on the same budget.

Two ways to keep that safe, and **this is a decision for you, not for an assistant**:

- Run the staging service only while reviewing, and pause it afterwards. Cheapest, one extra step.
- Or leave it running and accept the extra compute.

Nothing here has been purchased, enabled, or configured on your behalf.

---

## One-time setup

Roughly twenty minutes. Nothing below touches production.

### 1. A separate database

In the Neon console, on the same project as production, create a **branch** (Neon calls a separate
copy of a database a branch) named `staging`. A branch starts as a copy and diverges — writes to it
never reach the production branch.

Copy its connection string. **Do not paste it into a chat window, an issue, or a commit.**

> Free-tier limits change; check what your plan allows before creating one.

### 2. A staging API on Railway

1. Railway → **New Project** → **Deploy from GitHub repo** → `HomeTuition`.
2. Name it so nobody can mistake it for production — `hometuition-api-staging`. **Avoid the word
   "production" anywhere in the name**, or the preview workflow will refuse the URL.
3. Under **Variables**, set the same names as production, with staging values:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the **staging** Neon connection string from step 1 |
   | `SESSION_SECRET` | a **different** value from production, so a production token cannot sign in here |
   | `NODE_ENV` | `production` |
   | `DAILY_API_KEY` | your Daily key, or leave unset — video simply will not start |
   | `EXPO_PUBLIC_DAILY_DOMAIN` | `hometuition.daily.co` |

   Do **not** set `PORT`; Railway provides it.

   Do **not** set `ALLOW_TEST_TEACHING_ACCESS` yet. See step 4.

4. **Settings → Networking → Generate Domain.** Copy the address Railway gives you.

### 3. Tell the repository where staging is

GitHub → **Settings → Secrets and variables → Actions → Variables** → New repository variable:

- Name: `STAGING_API_URL`
- Value: the Railway domain from step 2, with `https://`

A variable, not a secret: it is a public hostname, and keeping it visible means anyone can check at
a glance that a preview is not pointed at production.

### 4. Create the tables, then — and only then — enable test access

The staging database is empty. From the repo root, with the **staging** connection string in your
local `.env`:

```
pnpm run db:push
```

Windows: `pnpm.cmd run db:push`, from `C:\Projects\Paathshala\Paathshala`.

**Order matters.** `ALLOW_TEST_TEACHING_ACCESS` must stay unset until after `db:push` has run on
that database. Verified by experiment: with the flag off and the table missing, the app is fine
(the code never queries it); with the flag on and the table missing, the teacher dashboard returns
**500**. So:

1. `db:push` against staging.
2. Then, if you want to test the grant feature, add `ALLOW_TEST_TEACHING_ACCESS=true` **on the
   staging Railway service only**.
3. Never on production. Before launch it must be off everywhere, with no live grants left.

---

## Running a preview

GitHub → **Actions** → **Preview a branch** → **Run workflow** → pick the branch → **Run**.

Leave `api_url` blank to use `STAGING_API_URL`, or type a different staging URL for a one-off. The
run prints the preview address in its summary when it finishes.

It stops before building if there is no staging API, if the URL is not `https://`, or if it looks
like production.

---

## What a preview still cannot tell you

- **The API is whatever is deployed to the staging service**, which is not automatic. If the
  staging Railway service is set to deploy from `main`, point it at the branch you are reviewing
  first, or you are testing new screens against an old server — the exact trap this document exists
  to prevent.
- **It is not the production database**, so it will not reproduce a bug that depends on real data.
- **A green preview is not a green test suite.** The workflow only typechecks and builds.
