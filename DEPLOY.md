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

3. **Settings → Networking → Generate Domain**. You get something like
   `hometuition-api.up.railway.app`. That is your API URL.
4. Check it: `https://<your-api-domain>/api/healthz` should return `{"status":"ok"}`

WebSocket traffic (the whiteboard) works over the same domain; the app derives `wss://`
from the API URL automatically.

---

## 3. Web app → Cloudflare Workers

The site runs on Cloudflare **Workers** static assets (`hometuition.praksh-dhakal.workers.dev`),
not Pages. `wrangler.jsonc` in the repo root already points at the build output and sets
single-page-application routing, so a shared link like `/classroom/123` still resolves after a
refresh instead of 404ing.

Unlike the API, which Railway redeploys automatically on push, **the web app is deployed by
hand**. Two commands, from the repo root:

```
pnpm --filter @workspace/sikshya run build
npx wrangler deploy
```

Set `EXPO_PUBLIC_API_URL` before building — it is baked in at **build time**, not read at run
time, so changing it means rebuilding:

```
EXPO_PUBLIC_API_URL=https://<your-api-domain> pnpm --filter @workspace/sikshya run build
```

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

`npx wrangler deploy` is unaffected either way. Note that `wrangler` is not a project
dependency — `npx` fetches it, so the first run takes a moment.

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
- **Payment confirmation is not verified.** `POST /sessions/:id/payment/confirm` trusts the
  caller because eSewa/Khalti are not integrated. Anyone could call it directly and skip
  paying. This must become a server-to-server verification before taking real money.
- **`.env` is gitignored** and must never be committed; set values in the hosting dashboards.
