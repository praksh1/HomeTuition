---
name: FamilyDoc is a separate project on the same machine
description: The owner has a second Nepal product — a telemedicine app at C:\Projects\FamilyDoc — with its own repo and no remote. Don't confuse the two working copies.
---

The owner is building two products. This repo is the teaching platform. The other is
**FamilyDoc**, a telemedicine app for Nepal, at `C:\Projects\FamilyDoc` — a separate git repo
with **no remote configured at all**, so it exists only on that machine.

They share a shape — Nepal-first, Daily.co video, OTP by SMS, a pnpm monorepo — which is
exactly what makes them easy to mix up.

**Why:** this caused a real mix-up. Asked to "commit my uncommitted changes", this repo was
clean while FamilyDoc held thirteen uncommitted files of in-progress prescription work. Looking
only at the obvious repo produced the confident and useless answer "there is nothing to
commit".

FamilyDoc's state as of 2026-08-19: prescriptions that are signed, verifiable by QR and
rendered to PDF, committed as work in progress at `fa085b5`. It does not typecheck —
`PrescriptionSigned`, `PrescriptionVoided` and `PrescriptionDownloaded` are referenced by the
routes but missing from the audit event enum. It has no GitHub repository yet.

**How to apply:**
- When the owner says "my changes" or "the repo" without naming one, check *both* working
  copies before answering. `git -C C:/Projects/FamilyDoc status` costs nothing.
- Do not push FamilyDoc anywhere until the owner has created a repository and said where. It
  is a medical product containing prescription-signing logic; publishing it is their decision.
- Do not copy patterns between the two on the assumption they are the same product. The
  overlap is superficial.
