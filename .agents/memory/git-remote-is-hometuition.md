---
name: origin points at the wrong repository
description: `origin` is the old Paathshala repo; the live one is the `hometuition` remote. A plain `git push origin` publishes to the wrong project.
---

This working copy has three remotes, and the obvious one is the wrong one:

- `origin` → `github.com/praksh1/Paathshala` — **an older repo, not where work goes**
- `hometuition` → `github.com/praksh1/HomeTuition` — **the live repository**
- `gitsafe-backup` → a local backup mirror

`main` is configured to track `hometuition/main`, so a bare `git push` goes to the right
place. Naming a remote explicitly is what goes wrong: `git push origin HEAD` looks completely
normal and silently publishes the work to the abandoned repository.

**Why:** this happened. A night's work was pushed to Paathshala by habit, and had to be pushed
to HomeTuition and then force-reset out of Paathshala to undo it. The owner had previously and
explicitly asked for a commit to be removed from Paathshala, so the two repos being confusable
is a known, live hazard rather than a hypothetical one.

**How to apply:**
- Push with plain `git push`, or spell out `git push hometuition HEAD:main`. Never `origin`.
- Before any push, confirm the target: `git config branch.main.remote` should say
  `hometuition`.
- If something does land in Paathshala, restore it with
  `git push origin +<previous-sha>:main` and re-push to `hometuition` — but check with the
  owner first, since force-pushing discards whatever is there.
- Deleting `origin` outright is a reasonable cleanup if the owner agrees; nothing in the
  project needs it.
