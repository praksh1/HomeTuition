# The container resets the checkout without warning

It has happened seven times in one session. Symptoms, in the order you notice them:

- `git log` is suddenly at a commit from hours ago
- `pnpm --filter ... run test:x` says "None of the selected packages has that script"
- a test run dies with a bare `Node.js v22.22.2` and no message
- `node --test src/lib/*.test.ts` reports a much smaller number than it did a minute ago

All four mean the same thing. Check `git log --oneline -3` first, not the test.

## Recovering

```
git fetch origin main && git reset --hard origin/main
pnpm install --frozen-lockfile
pnpm run typecheck:libs     # @workspace/db must be rebuilt or every import of it fails
```

The database and `.env` go too. Rebuild:

```
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/ht -A trust -U postgres"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/ht -o '-p 55432 -k /tmp' -l /tmp/pglog/pg.log start"
psql "postgres://postgres@127.0.0.1:55432/postgres" -tAc "create database ht"
# write .env with local-only values, then:
pnpm run db:push
```

`pg_ctl -l` needs a path postgres itself can write to. The scratchpad directory is owned by
another user, so it fails with "could not start server" and *no log to examine* — which reads
as postgres being broken. Use `/tmp/pglog` with mode 777.

## What actually costs time

Not the recovery — that is five minutes. It is the uncommitted work, which is gone. An hour of
building the cancellation refunds was lost this way after being typechecked and tested but not
committed.

**Commit as soon as it typechecks, before you test it.** A `wip:` commit that is squashed into
a real one twenty minutes later costs nothing and survives a reset. Waiting for the tests to go
green before the first commit is how the work gets lost, because that is exactly the window
where you are running long test suites and the container is most likely to be reclaimed.
