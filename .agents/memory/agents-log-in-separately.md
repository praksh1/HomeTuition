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

### What that means in practice

The current implementation does **not** match this yet. What exists today is:

- `artifacts/sikshya/app/desk.tsx` — a signpost route that sends an already-signed-in agent to
  `/(admin)`. It holds no login of its own.
- Agent creation by `UPDATE users SET role = 'admin' WHERE email = ...`, documented in
  `ISSUES.md` under *How an agent account is made*.

Both need to change. Anything built on top of them should assume they are temporary.
