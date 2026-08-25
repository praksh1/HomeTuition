---
name: The Daily API key was compromised and has been rotated
description: The old key was pasted into a chat transcript and was live for months. The owner rotated it on 2026-08-24 and updated Railway. Do not keep raising it as an outstanding task — it is done.
---

**Done. The owner rotated `DAILY_API_KEY` on 2026-08-24 and updated it in Railway.** Do not
raise this again as an outstanding pre-launch item.

### What it was

The original key was included in a chat transcript early in this project's life, so it had to be
treated as public: anyone holding it could create rooms, join any room, and run up charges on
the owner's Daily account. It was left in place while the project had a single tester, on the
reasoning that rotating it would break the running app until the new value reached Railway.

### Why this note still exists

Two reasons, both about not repeating a mistake.

**A secret that reaches a transcript is burnt.** It cannot be un-sent, and "we will rotate it
later" carries the exposure for however long later takes — here, months. Never paste a key,
connection string or token into chat; hand over the variable *name* and let the owner put the
value in Railway themselves.

**A reminder recorded in several places has to be cleared in all of them.** This was written
into `ISSUES.md`, `DEPLOY.md` and here, deliberately, so it could not be forgotten. The cost of
that is that after the owner acts, a stale copy left anywhere gets read back to them as
outstanding work — which is exactly what happened, and it is a waste of their time. When the
owner says something is done, clear every copy in the same change.
