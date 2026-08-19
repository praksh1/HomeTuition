---
name: origin points at the wrong repository — on the owner's Windows copy
description: On that machine `origin` is the old Paathshala repo and the live one is the `hometuition` remote, so `git push origin` publishes to the wrong project. A fresh clone has one correct `origin`; run `git remote -v` to tell them apart.
---

**This applies to the owner's Windows working copy, not to every clone.** A fresh clone — a
Claude Code session on the web, CI, a new machine — has a single remote named `origin` pointing
at `github.com/praksh1/HomeTuition`, and pushing to `origin` there is correct. Check before
trusting either rule: `git remote -v` settles it in one command, and the danger below is real
only where more than one remote exists.

On that Windows copy there are three remotes, and the obvious one is the wrong one:

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
- Run `git remote -v` first. One remote named `origin` → it is a fresh clone, push normally.
  Three remotes → this is the Windows copy and the rest of this entry applies.
- There, push with plain `git push`, or spell out `git push hometuition HEAD:main`. Never
  `origin`.
- Before any push on that copy, confirm the target: `git config branch.main.remote` should say
  `hometuition`.
- If something does land in Paathshala, restore it with
  `git push origin +<previous-sha>:main` and re-push to `hometuition` — but check with the
  owner first, since force-pushing discards whatever is there.
- Deleting `origin` outright is a reasonable cleanup if the owner agrees; nothing in the
  project needs it.
