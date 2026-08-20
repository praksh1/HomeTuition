---
name: The API URL is baked into the web build, and the docs had the wrong one
description: EXPO_PUBLIC_API_URL is compiled into the bundle, so building with a wrong domain ships a site that cannot reach its backend and fails silently. DEPLOY.md carried a plausible but dead domain as though it were real.
---

The live API is `https://workspaceapi-server-production-5a63.up.railway.app`. Railway generates
that name; it is **not** derived from the project name and cannot be guessed.

`EXPO_PUBLIC_API_URL` is substituted into the JavaScript at build time, not read at run time. So
a wrong value is not a misconfiguration you can correct later in a dashboard — it is compiled
into the deployed site, and the only fix is another full build and deploy.

**Why:** `DEPLOY.md` step 3 used to read "You get something like `hometuition-api.up.railway.app`.
That is your API URL." — an illustrative placeholder in the first sentence, asserted as fact in
the second. That domain 404s. It was read out of the doc and handed to the owner inside a deploy
command; had he run it, the deploy would have "succeeded" and produced a site whose every
request went to a dead host. He checked it himself and caught it. Nothing in the build, the
deploy, or the site's first paint would have reported the problem — login simply fails.

**How to apply:**
- Never quote a deployment URL from memory or from prose. Confirm it first:
  `https://<domain>/api/healthz` returns `{"status":"ok"}`; a `404` means the domain is wrong,
  not that the API is down.
- The same caution applies to the board URL hard-coded at `SmartBoard.tsx:41`
  (`https://hometuition.praksh-dhakal.workers.dev`). The **native apps load the whiteboard from
  that address**, so if it is wrong or stale, phone whiteboards break while the rest of the app
  keeps working.
- After deploying, verify what actually shipped rather than trusting `wrangler deploy`'s exit
  code — the API URL is a plain string in the served bundle, so it can be read back from
  outside. `DEPLOY.md` → "Verify the deploy actually shipped" has the command.
- A Claude Code session in the cloud **cannot reach either host**: outbound traffic is limited
  to package registries and GitHub, so `curl` returns `000` for both. That is a sandbox
  restriction and says nothing about whether the site is up. Do not report it as an outage, and
  do not claim to have verified a URL you could not fetch.
