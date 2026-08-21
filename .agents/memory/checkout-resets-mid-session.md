---
name: The checkout can reset to an old commit mid-session
description: A cloud working copy can be silently rewound to an older commit while you are working in it; re-sync before doing anything, and never paste a file you edited before the rewind over the tree after it.
---

The working copy in a cloud session can be reset to an older commit **without warning and in the
middle of a task**. It has happened repeatedly, always landing on the same stale commit. Pushed
work is safe — this is a local checkout being rewound, not history being lost — but everything
uncommitted goes, and what you *read* just before the rewind is now wrong.

**How it announces itself, badly.** Not with an error. With something unrelated failing for no
reason: a typecheck error in a file nobody touched, a test that passed a minute ago, a feature
you know exists appearing to be missing. `git log --oneline -1` is the check, and it is worth
running the moment anything surprising happens.

**Recovering:**

```
git fetch origin main && git reset --hard origin/main && pnpm install
```

`pnpm install` matters: the reset can leave the workspace's built packages inconsistent with the
source, which shows up as `@workspace/db has no exported member ...`.

## The mistake to avoid, because it was already made once

After a rewind, a file you edited *before* it still exists in your editor or a scratch copy — and
copying that over the re-synced tree **silently reverts every commit that touched that file since
the stale commit**. That is what happened to `routes/messages.ts`: an endpoint written against
the old copy was pasted over the new one and took out the `notify()` call that pushes a new
message to the recipient's channel. The endpoint worked. Ten unrelated notification checks went
red, and the reason was nowhere near them.

So after re-syncing, **re-apply the change to the current file** rather than restoring your copy
of it. Then prove it:

```
git diff --stat <file>        # additive-looking?
git diff <file> | grep '^-'   # every deletion should be one you meant
```

A diff that removes lines you never wrote is the signal. Run the suites that cover the file too,
not just the ones covering your change — the damage lands where you are not looking.
