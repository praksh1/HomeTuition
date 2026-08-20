---
name: origin points at the wrong repository — on the owner's Windows copy
description: On that machine `origin` is the old Paathshala repo and the live one is the `hometuition` remote, so `git push origin` publishes to the wrong project. A fresh clone has one correct `origin`; run `git remote -v` to tell them apart.
---

**On the owner's Windows machine, `git push origin` publishes work to an abandoned repository.**
It has happened — a night's work went to the wrong project and had to be force-reset back out
of it. Treat any command naming `origin` on that machine as a mistake.

**Which case am I in?** `git remote -v` answers it in one command, and it is worth running
before the first push of any session:

- **Three remotes** (`origin`, `hometuition`, `gitsafe-backup`) → the owner's Windows copy. The
  danger below is live. Never name `origin`.
- **One remote called `origin` pointing at `github.com/praksh1/HomeTuition`** → a fresh clone: a
  Claude Code session in the cloud, CI, a new machine. Pushing to `origin` there is correct and
  is how work normally lands.

On the Windows copy there are three remotes, and the obvious one is the wrong one:

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
