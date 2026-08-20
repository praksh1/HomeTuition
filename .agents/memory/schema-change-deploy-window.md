---
name: A new column on an existing table takes the site down until db:push runs
description: The API redeploys on push while db:push is manual, so code is always newer than the database for a while. Drizzle names every column in INSERT and bare select(), so a new column breaks sign-in and registration in that window. A new table does not.
---

The API redeploys itself whenever `main` is pushed (Railway watches the repo). `pnpm run
db:push` is a separate command the owner runs by hand from his laptop. **They are never in
step**, so every schema change has a window where the deployed code expects something the
database does not have yet.

What happens in that window depends entirely on the shape of the change, and the difference is
much bigger than it looks:

**A new column on an existing table takes the whole app down.** Drizzle names every column the
schema declares — in `INSERT`, and in a bare `db.select().from(table)`. Adding
`notification_prefs` to `users` and deploying before `db:push` was measured, not guessed:

```
register -> 500
login    -> 500
```

Not "notifications don't work". Nobody can sign in.

**A new table is safe.** Nothing that already exists refers to it, so every existing query is
unaffected. Only the feature that needs it waits.

**How to apply:**

- Prefer a new table for anything new. `user_notification_prefs` is a table rather than a
  column on `users` for exactly this reason, and the API creates it at boot
  (`artifacts/api-server/src/lib/ensureSchema.ts`) so nobody has to run anything.
- If a change genuinely needs a column on an existing table, ship it in **two** deploys: the
  column first (via `db:push`), the code that reads it second. Never both at once.
- `artifacts/api-server/src/routes/auth.ts` now names its columns explicitly (`AUTH_COLUMNS`)
  instead of using a bare `select()`. Keep it that way — it is what stops a future schema
  change from breaking sign-in. Note this does **not** protect `INSERT`, which is why the rule
  above still stands.
- Never automate `drizzle-kit push` in the Railway start command. It can drop things, and a
  failure there would stop the server booting at all. The boot-time `CREATE TABLE IF NOT
  EXISTS` is deliberately narrow: additive only, idempotent, and unable to fail the start-up.
