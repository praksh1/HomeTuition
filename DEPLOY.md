# Deploying

Three pieces: the database (already hosted), the API server, and the web app.
The phone apps are built separately — see the end.

Everything below assumes the code is pushed to GitHub (HomeTuition).

---

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

## 4. After the first deploy

**Create the database tables** (once, from your laptop, pointed at the same Neon database):

```bash
pnpm run db:push
```

**Optionally seed demo data:**

```bash
pnpm run seed
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
