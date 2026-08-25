# Deploying

Three pieces: the database (already hosted), the API server, and the web app.
The phone apps are built separately — see the end.

Everything below assumes the code is pushed to GitHub (HomeTuition).

---

> **Before a public launch — iOS, Android, or telling real users about the web app — read the
> checklist at the top of `ISSUES.md`.** The Daily.co API key that used to head that list was
> rotated by the owner on 2026-08-24 and is no longer outstanding.


## Why this matters beyond "being live"

Browsers refuse camera and microphone access on plain `http://` — only `https://` and
`localhost` qualify. So video calls **cannot** be tested from a phone browser against your
laptop's LAN address, no matter how the app is configured. Deploying is what makes phone
testing possible, not just a launch step.

---

## 1. Database — done

Neon already hosts it. Copy the connection string from the Neon dashboard; it is the
`DATABASE_URL` used below.

---

## 2. API server → Railway

`railway.json` in the repo root already sets the build and start commands.

1. Railway → **New Project** → **Deploy from GitHub repo** → pick `HomeTuition`
2. Add these under **Variables**:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | your Neon connection string |
   | `SESSION_SECRET` | the value from your local `.env` — reuse it, or everyone gets logged out |
   | `DAILY_API_KEY` | your Daily key |
   | `EXPO_PUBLIC_DAILY_DOMAIN` | `hometuition.daily.co` |
   | `NODE_ENV` | `production` |

   Do **not** set `PORT` — Railway provides it.

   **Optional, and only if you want email notifications.** Nothing in this project could send
   an email until now, and it still cannot until these exist. Leave them out and the app tells
   users plainly that email is off, rather than showing switches that do nothing:

   | Name | Value |
   |---|---|
   | `RESEND_API_KEY` | an API key from a free account at resend.com |
   | `EMAIL_FROM` | the address mail appears to come from — see below |
   | `APP_URL` | where the app is served, so links inside emails work: `https://hometuition.praksh-dhakal.workers.dev` |

   **`EMAIL_FROM` needs a domain, and that is the whole difficulty.** Mail claiming to come
   from a domain you cannot prove you own is refused or filed as spam — that is how email
   works, not a rule Resend invented. So there are two answers depending on what you have:

   - **No domain yet:** use `onboarding@resend.dev`, Resend's test sender. It works
     immediately and delivers **only to the address that owns your Resend account**. Mail to
     students is rejected. Good for confirming the feature runs end to end; not something to
     launch on.
   - **A domain you own:** `hello@yourdomain.com`, or `Sikshya <hello@yourdomain.com>` if you
     want a name beside it. You add two or three DNS records at your registrar and Resend
     verifies them. A .com is roughly $10-15 a year; Nepal's `.np` is free to Nepali citizens
     and businesses through Mercantile, but it is a paperwork process rather than a purchase.

   Worth settling the app's **name** before buying anything — see the pre-launch checklist in
   ISSUES.md, which records that it is expected to change again.

   Setting these with a domain that is not verified is safe: Resend rejects the send, the
   server logs it and carries on, and the notification still arrives in the app. A mail
   provider that is down can never break the thing it was notifying about.

   Like payments, this is inferred rather than switched: the server sends email when it has a
   provider and does not when it does not. There is no flag to get wrong.

3. **Settings → Networking → Generate Domain**. Railway generates the name; it is **not**
   derived from the project name and is not guessable. The live one is:

   ```
   https://workspaceapi-server-production-5a63.up.railway.app
   ```

   > Treat that as a fact with a shelf life. This line previously carried a plausible-looking
   > example — `hometuition-api.up.railway.app` — phrased as though it were the real domain. It
   > is not; it 404s. Building the web app against it ships a site that cannot reach its
   > backend at all, and nothing about the build fails to warn you. **Check the domain before
   > every build** (step 4), and if it has changed, correct this line.

4. Check it: `https://<your-api-domain>/api/healthz` should return `{"status":"ok"}`. A `404`
   means the domain is wrong, not that the API is broken.

WebSocket traffic (the whiteboard) works over the same domain; the app derives `wss://`
from the API URL automatically.

---

## 3. Web app → Cloudflare Workers

The site runs on Cloudflare **Workers** static assets (`hometuition.praksh-dhakal.workers.dev`),
not Pages. `wrangler.jsonc` in the repo root already points at the build output and sets
single-page-application routing, so a shared link like `/classroom/123` still resolves after a
refresh instead of 404ing.

**The web app now deploys itself too.** `.github/workflows/deploy-web.yml` runs on every push
to `main`: it typechecks, builds, runs the whiteboard tests, deploys to Cloudflare, and then
reads the API address back out of the live bundle to prove the deploy actually landed. Nothing
below needs doing by hand any more — it is kept because it is what the workflow does, and
because it is how to deploy if the workflow is ever broken or unavailable.

There is also a button: **Actions → Deploy the web app → Run workflow**.

The one-time setup is a `CLOUDFLARE_API_TOKEN` repository secret (Settings → Secrets and
variables → Actions), created from the "Edit Cloudflare Workers" template at
**dash.cloudflare.com → My Profile → API Tokens**. Until it exists the workflow still runs
every check, and simply skips the deploy with a note rather than failing.

---

To deploy by hand instead, two commands from the repo root:

```
pnpm --filter @workspace/sikshya run build
npx wrangler deploy
```

Set `EXPO_PUBLIC_API_URL` before building — it is baked in at **build time**, not read at run
time, so changing it means rebuilding. On Windows, in PowerShell (the one-line
`VAR=value command` form below it is Mac/Linux syntax and PowerShell rejects it):

```
$env:EXPO_PUBLIC_API_URL = "https://workspaceapi-server-production-5a63.up.railway.app"
pnpm.cmd --filter @workspace/sikshya run build
npx.cmd wrangler deploy
```

On Mac or Linux:

```
EXPO_PUBLIC_API_URL=https://<your-api-domain> pnpm --filter @workspace/sikshya run build
```

### Verify the deploy actually shipped

`wrangler deploy` reporting success only means files were uploaded. To confirm the live site is
the build you think it is, read the API URL back out of the bundle it is serving — it is baked
in as a plain string, so it can be checked from outside with no login:

```
$idx = curl.exe -s https://hometuition.praksh-dhakal.workers.dev/
$js  = [regex]::Match($idx, '_expo/static/js/web/entry-[A-Za-z0-9._-]+\.js').Value
(curl.exe -s "https://hometuition.praksh-dhakal.workers.dev/$js" |
  Select-String -Pattern 'https://[A-Za-z0-9.-]+\.up\.railway\.app' -AllMatches
).Matches.Value | Select-Object -Unique
```

It should print your API domain and nothing else. A wrong domain here is the failure this
section exists to prevent; an empty result means the bundle did not update. (`curl.exe`, not
`curl` — in PowerShell `curl` is an alias for something else entirely.)

### Two things that will trip you up on Windows

**Run it from the repo root, which is the *nested* folder.** The project lives at
`C:\Projects\Paathshala\Paathshala` — one level below the folder of the same name. Running
from the parent gives `ERR_PNPM_NO_PKG_MANIFEST: No package.json found`.

**`pnpm` may be blocked by PowerShell.** Windows refuses to run unsigned `.ps1` scripts, and
pnpm installs one, so `pnpm ...` fails with `UnauthorizedAccess` / "running scripts is disabled
on this system". Use `pnpm.cmd` instead, which is not a PowerShell script and is unaffected:

```
pnpm.cmd --filter @workspace/sikshya run build
```

The same applies to `npx`: use **`npx.cmd wrangler deploy`**. This doc previously claimed
`npx` was exempt; it is not, and it fails the same way on the owner's machine. Note that
`wrangler` is not a project dependency — `npx` fetches it, so the first run takes a moment.

---

## 3b. Uploaded files → Cloudflare R2

**Do this when you want support attachments to work.** Everything else runs without it — the app
simply says "File uploads are not set up on this server yet", and a report still goes through
with its words, just not its photo.

R2 was chosen over Amazon S3 for two reasons: **there are no egress charges, ever** (S3 bills you
every time somebody downloads a file, which is the line item that surprises people), and you
already have a Cloudflare account for the web app. The free tier is 10 GB of storage, 1 million
uploads a month and 10 million downloads a month. For support attachments you will not come close.

### Make the bucket

1. Go to **dash.cloudflare.com** and sign in.
2. In the left sidebar, click **R2 Object Storage**. The first time, it asks you to agree to the
   R2 terms and add a payment card. **Adding the card does not charge you** — it is there so you
   are not cut off the day you exceed the free tier. You can set a spend alert on the same page.
3. Click **Create bucket**.
4. Name it `hometuition-uploads`. Any name works, but it must match the variable below exactly.
5. Location: **Automatic** is fine. If you want to pin it, choose **Asia-Pacific**.
6. Click **Create bucket**. Leave it **private** — do not enable public access. Files are served
   through short-lived signed links, which is what keeps a student's evidence photo private.

### Make the keys

1. Still in **R2**, click **Manage R2 API Tokens** (top right of the R2 page), then
   **Create API token**.
2. Name it `hometuition-api`.
3. Permission: **Object Read & Write**.
4. Under *Specify bucket*, choose **Apply to specific buckets** and pick `hometuition-uploads`.
   A token that can only touch this one bucket is worth the extra click.
5. TTL: leave as **Forever**.
6. Click **Create API Token**.
7. You now see three things **once**. Copy all three somewhere safe before leaving the page:
   - **Access Key ID**
   - **Secret Access Key**
   - the **endpoint**, which looks like `https://<a long hex string>.r2.cloudflarestorage.com`

   That long hex string is your **Account ID**. It is also shown on the R2 overview page.

### Put them on Railway

1. **railway.app** → your project → the **api-server** service → **Variables**.
2. Add four:

   | Name | Value |
   |---|---|
   | `R2_ACCOUNT_ID` | the long hex string from the endpoint |
   | `R2_ACCESS_KEY_ID` | the Access Key ID |
   | `R2_SECRET_ACCESS_KEY` | the Secret Access Key |
   | `R2_BUCKET` | `hometuition-uploads` |

3. Railway restarts the service on its own, in about a minute.

### Check it worked

Open the live site, go to **Support**, write anything, attach a photo, and submit. If it says
"Our support team will review your report" you are done. If it says "your file did not go with
it", the message names the reason.

To see it from the other side: an agent opening that ticket now gets **Open the attachment**
rather than a line of gibberish.

### Things worth knowing

- **Never paste these keys into a chat, an issue, or the repo.** They can read and write every
  file in that bucket. If one leaks, delete the token in Cloudflare and make a new one — the
  four variables above are the only place it lives.
- **10 MB per file, photos and PDFs only.** Both are enforced on the server, and a file that
  breaks either rule is deleted from the bucket rather than left sitting there costing you.
- **A view link lasts ten minutes.** That is deliberate: a URL that ends up in a screenshot or a
  forwarded message stops working almost immediately.
- **Costs, honestly.** At the free tier you pay nothing. Past it, R2 is about $0.015 per GB per
  month with no charge for downloads. A thousand support photos at 3 MB each is 3 GB — roughly
  five US cents a month.

---

## 4. After the first deploy

**Create the database tables** (once, from your laptop, pointed at the same Neon database):

```
pnpm.cmd run db:push
```

Run this again whenever a change adds a table or a column. It is safe on a live database: it
adds what is missing and leaves existing rows alone.

> **Why the ordering matters.** The API redeploys itself on every push; this command is one you
> run by hand. So there is always a window where the code is newer than the database. A new
> *column* on an existing table is dangerous in that window — Drizzle names every column in its
> queries, so sign-in and registration both fail with a 500 until this runs. A new *table* is
> not: nothing else touches it. Prefer a new table, and where a change really does need a
> column, deploy it in two steps — add the column first, then the code that uses it.

**Optionally seed demo data:**

```
pnpm.cmd run seed
```

---

## Testing on phones

Open the Cloudflare URL in Safari or Chrome on the phone. Because it is HTTPS, the camera
and microphone work — which is the whole point.

The **installed** Android/iOS app is separate: it is built from the same code but ships as an
APK/IPA and talks to the same API. Rebuild it after changing `EXPO_PUBLIC_API_URL`, since that
value is compiled into the bundle.

---

## Gotchas

- **`SESSION_SECRET` must match** whatever signed existing logins, or every user is signed out.
- **`EXPO_PUBLIC_API_URL` is baked in at build time.** Changing the API domain means
  redeploying the web app, not just the API.
- **Daily rooms expire 6 hours after creation** (`artifacts/api-server/src/lib/daily.ts`).
- **Booking is free in production today.** No payment provider is integrated, so the server
  approves its own charges (*simulated* mode) and anyone can book a paid class for nothing.
  This must be resolved before launch. The old unverified `POST /sessions/:id/payment/confirm`
  endpoint this line used to warn about is **gone** — booking is now one atomic transaction at
  `POST /sessions/:id/book`. Do not add provider variables to Railway hoping to close the hole:
  that flips the server to *gateway* mode and, with no provider actually wired up, declines
  **every** booking. See `.agents/memory/payment-mode-trap.md`.
- **`.env` is gitignored** and must never be committed; set values in the hosting dashboards.
