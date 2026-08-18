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

## 3. Web app → Cloudflare Pages

1. Cloudflare → **Workers & Pages** → **Create** → **Pages** → connect `HomeTuition`
2. Build settings:

   | Field | Value |
   |---|---|
   | Build command | `pnpm install --frozen-lockfile && pnpm --filter @workspace/sikshya run build` |
   | Build output directory | `artifacts/sikshya/web-build` |

3. Environment variable — **this is the important one**:

   | Name | Value |
   |---|---|
   | `EXPO_PUBLIC_API_URL` | `https://<your-api-domain>` (from step 2, no trailing slash) |

   It is read at **build time**, not run time. Change it and you must redeploy.

4. Deploy. You get `hometuition.pages.dev`, and can attach your own domain under
   **Custom domains**.

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
