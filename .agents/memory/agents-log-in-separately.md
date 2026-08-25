---
name: Customer-care agents log in on their own page, not through the app
description: The owner's decision, stated more than once. Agents must not sign in through the same login form as teachers and students, and their accounts are created by an administrator rather than self-registered and promoted. Do not re-argue this.
---

**This is decided. Do not re-open it, and do not offer a "same login, routed by role" design as
best practice — that argument has already been made and rejected.**

The owner wants:

- **A separate web page for operators/agents to log in.** Not a link in the corner of the app,
  and not the same form with role-based routing behind it.
- **Accounts created by an administrator.** Not "register through the app like anyone else,
  then promote the row" — the administrator issues the credentials.

### Why this note exists

An earlier session was told this, did not record it, and later proposed the opposite —
presenting "agents sign in at the same form, the app routes them by role" as a recommendation,
with reasoning about not advertising the support surface. The reasoning was not the problem.
Presenting a decision the owner had already made as though it were still the assistant's to
make was the problem, and it cost them a round of correction.

If a design constraint here looks wrong, say so in a sentence and then build what was asked.

### The shape, decided 2026-08-25

- **Its own address.** A second Cloudflare Worker on its own URL, built from its own route
  tree. Not a path inside the student/teacher site, and nothing in that site links to it.
- **Its own login form.** Operators never see the app's login.
- **Accounts created by an administrator**, who sets an ID and gets a **one-time password shown
  once**. The operator must change it on first sign-in, so nobody — the administrator included
  — knows their working password.

### How a second site gets built from this repo

The route tree comes from `app.json` → `expo.extra.router.root`, which `@expo/cli` reads via
`getRouterDirectoryModuleIdWithManifest` and hands to babel as the `routerRoot` caller option;
`babel-preset-expo` then inlines it as `EXPO_ROUTER_APP_ROOT`, which is what `expo-router`'s
`require.context` resolves. It defaults to `./app`.

So an `app.config.js` that switches that value on an env var produces a **second bundle from a
second directory**, reusing the existing admin screens rather than rewriting them:

```js
extra: { router: { root: process.env.OPERATOR_BUILD ? "./app-operator" : "./app" } }
```

Then a second wrangler config points at that build output. `expo export --config` was removed
in SDK 54 — do not reach for it.

### What that means in practice

The current implementation does **not** match this yet. What exists today is:

- `artifacts/sikshya/app/desk.tsx` — a signpost route that sends an already-signed-in agent to
  `/(admin)`. It holds no login of its own.
- Agent creation by `UPDATE users SET role = 'admin' WHERE email = ...`, documented in
  `ISSUES.md` under *How an agent account is made*.

Both need to change. Anything built on top of them should assume they are temporary.
