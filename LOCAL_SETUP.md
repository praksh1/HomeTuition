# Running Fadko on your own computer

No Replit needed. You need [Node.js](https://nodejs.org) 22+ and pnpm (`npm install -g pnpm`).

## One-time setup

**1. Get a database.** Sign up free at [neon.com](https://neon.com), create a project, copy the
connection string from the dashboard.

**2. Put it in `.env`.** Open the `.env` file in this folder and replace the `DATABASE_URL`
line with your connection string. (If `.env` is missing, copy `.env.example` to `.env`.)

**3. Install everything.** In a terminal, from this folder:

```bash
pnpm install
```

**4. Create the database tables:**

```bash
pnpm run db:push
```

**5. Load the demo teachers and students:**

```bash
pnpm run seed
```

## Running it

You need **two terminals open at the same time**, both in this folder.

Terminal 1 — the API server (leave it running):

```bash
pnpm run dev:api
```

Terminal 2 — the app (leave it running):

```bash
pnpm run dev:app
```

Then open **http://localhost:8081** in your browser.

To stop either one, click its terminal and press `Ctrl + C`.

## Demo logins

Password for all of them is `password123`.

| Role | Email |
|------|-------|
| Teacher | `ram@example.com` |
| Teacher | `sunita@example.com`, `bishnu@example.com`, `priya@example.com`, `kiran@example.com` |
| Student | `student@sikshya.np` |

## Video calls

Video will show "Couldn't set up the video room" unless you add a Daily.co API key to `.env`:

```
DAILY_API_KEY=your_key_here
EXPO_PUBLIC_DAILY_DOMAIN=yourdomain.daily.co
```

Everything else — whiteboard, uploads, zoom, chat, logins, payments — works without it.

### Trying LiveKit instead

LiveKit is being trialled as a replacement, because Daily charges per person per minute and the
monthly tier does not survive that. Four more lines in the same `.env`:

```
VIDEO_PROVIDER=livekit
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_URL=wss://your-project.livekit.cloud
```

Then check them before starting anything:

```
pnpm.cmd run livekit:check
```

It says in plain words whether each value is present, whether the secret can sign a token, and
whether LiveKit accepts them — and what to do about each failure. Worth the twenty seconds,
because a wrong secret and a bad connection produce the same message inside the app.

Delete the `VIDEO_PROVIDER` line to go back to Daily. Nothing else changes and there is nothing
to rebuild. Phones keep Daily either way — the server decides per device, so you cannot break
them by leaving this switched on.

The full picture, including the two-person test, is in `VIDEO.md`.

## If something breaks

| Problem | Fix |
|---|---|
| `DATABASE_URL is not set` | The `.env` file is missing or the line wasn't replaced. |
| `EADDRINUSE` / port in use | An old server is still running. Close the other terminal, or restart your PC. |
| App loads but everything is empty | The API server (terminal 1) isn't running, or `pnpm run seed` was never run. |
| `Use pnpm instead` | You typed `npm install`. Use `pnpm install`. |

## Files that hold settings

- `.env` (this folder) — database URL, login secret, port. **Never commit this.**
- `artifacts/sikshya/.env` — tells the app where the API is. Change it if you change `PORT`.
