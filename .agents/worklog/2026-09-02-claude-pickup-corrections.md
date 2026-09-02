# 2026-09-02 — Claude pickup packet for owner corrections

## Scope requested

The owner is pausing Codex work for a few days and asked for a complete, high-standard handoff to
Claude covering seven follow-ups: operator decision wording, pre-payment plan locks, password
reset behavior/security, temporary test access, disabling board shape recognition, fixing the
Daily window minimize control, and a parallel cheaper video-provider experiment. They explicitly
asked the next assistant to keep a detailed record for Codex's eventual return.

## Work completed in this entry

- Read the standing project instructions and the relevant memory/HANDOVER entries.
- Inspected the actual operator credential decision route and operator person screen.
- Inspected the password reset request/consume implementation and both reset screens.
- Inspected the shared teaching-access server gate and teacher subscription screen.
- Located the active SmartBoard shape-recognition hook.
- Inspected both classroom files' hidden/small/medium/full call-window state handlers.
- Re-read the existing video-provider research and provider-neutral server/client seams.
- Wrote the implementation and acceptance packet at
  `.agents/backlog/2026-09-02-owner-corrections-and-stream-poc.md`.
- Linked the packet from the Memory index and HANDOVER so the next agent cannot miss it.

## Important evidence, not assumptions

- `admin.ts` currently constructs `Your ${label} was approved.` and uses the subject
  `Sikshya document approved`; the misleading citizenship wording is real.
- `(admin)/person/[id].tsx` currently shows `Saved` / `They have been told.`; the casual operator
  confirmation is real.
- `mayBuyTeacherPlan()` already blocks unverified and unapproved teachers on the server. The
  subscription screen still opens the simulated payment UI before that server refusal.
- The emailed reset-token implementation already declares a 30-minute expiry and queries
  `expires_at >= now()`. Therefore the reported two-day-old success needs reproduction and
  deployment/data-path diagnosis; adding another expiry check without understanding which route
  served the link would be cargo culting.
- New reset tokens invalidate prior unused tokens, and successful use marks all unused account
  tokens for that user used. Current code does **not** compare the proposed password with the
  existing password.
- The forgot-password screen does not enter a submitted state; the button becomes available
  again immediately. The reset screen has no show/hide controls.
- `SmartBoard.web.tsx` actively runs `recognizeShape()` over freehand elements. HANDOVER had
  already warned it was never tested by a real teacher; the owner has now rejected it after a
  real-use failure.
- Both classroom screens already model `hidden`, `small`, `medium`, and `full`, keep the video
  mounted, and have separate Show/Hide behavior. The top minus currently toggles medium/small;
  the owner reports no meaningful visible effect, so semantics and layout require a manual fix.
- The existing research names Stream Video—not LiveKit—as the recommended first proof of
  concept. LiveKit/self-hosting is a later technical-operations option. Daily is still the only
  real registered provider; `echo` is the test stub.

## Product decisions captured

- A document can be accepted for Sikshya's review without implying government identity or the
  whole teacher account was approved.
- Plan choices must be visibly locked before payment for unverified/unapproved teachers, while
  the server gate remains authoritative.
- After reset request, replace the form with a generic confirmation. A resend is useful, but only
  after a visible/server-enforced cooldown; it should not be an immediately reusable submit box.
- Reset links are 30-minute, single-use links; old/current password reuse is rejected.
- Testing needs an audited, expiring, operator-granted payment bypass—not a global production
  unlock or fake receipt.
- Automatic shape conversion is disabled; explicit Excalidraw shape tools stay.
- The call window retains Show/Hide. Minimize must visibly snap to a compact bottom-right preview
  with Restore, or the duplicate control must be removed.
- Stream is developed on a separate branch behind the provider seam; Daily remains production.

## Deliberately not done

- No application, API, schema, business-logic, whiteboard, classroom, or provider code changed.
- No external account was created and no Brevo, Railway, Cloudflare, Daily, or Stream setting was
  touched.
- No payment was attempted and no production test entitlement was created.
- No app build, preview deploy, production deploy, or database migration was run.
- No source tests were run because this entry changes documentation only. The documentation diff
  was checked before commit.

## What went right / wrong

- Right: the repository already has strong server-side plan gates and reset-token primitives;
  the follow-up is narrower than the symptoms initially suggested.
- Right: existing video research and provider seams prevent the next assistant from restarting
  the provider decision from scratch.
- Wrong/limitation: the first broad search traversed a generated Nepal schools data file and
  produced heavily truncated output. It changed nothing. The inspection was rerun against exact
  files and line regions, which produced the evidence summarized above.
- Limitation: the owner's two-day reset-link result was not reproduced in this documentation
  turn. It remains a release-blocking defect report for the implementation slice.

## Next pickup

Start with section 1 of the backlog packet, deploy only a branch preview, and obtain owner
approval before merging. Maintain one dated worklog per slice with exact commands/results and
keep a rolling status table in the backlog packet if work spans more than one session.
