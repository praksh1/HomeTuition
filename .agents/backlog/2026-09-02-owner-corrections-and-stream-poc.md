# Owner correction packet — 2026-09-02

This is the next implementation packet from the product owner. It is deliberately written as
acceptance criteria rather than a vague wish list. **None of the product changes below were
implemented in the documentation-only handoff that created this file.** Daily remains the live
provider, payment remains simulated/not live, and the production site was not redeployed.

Read `CLAUDE.md`, `.agents/memory/MEMORY.md`, `HANDOVER.md`, `DESIGN.md`, and the latest worklog
before starting. Work one risk-contained slice at a time, test it, record it, commit it, push it
to the Claude branch, deploy a branch preview, and give the non-technical owner the exact
clickable preview URL. Do not merge or deploy to production until the owner approves that slice.

## Priority and suggested slices

1. Operator decision language and notification/email truthfulness.
2. Pre-payment plan lock for unapproved teachers.
3. Password reset UX and security audit/fix.
4. Expiring operator-granted test teaching entitlement.
5. Disable automatic whiteboard shape conversion.
6. Make the call-window state controls honest and functional.
7. In a separate branch/worktree, build a Stream Video proof of concept behind the provider
   seam. Do not change the provider used by production.

Items 1–6 may share the existing feature branch but should remain small reviewable commits.
Item 7 must be isolated so an unfinished video experiment cannot destabilize Daily or the
classroom.

---

## 1. Professional, precise operator decisions

### Problem observed

The person screen currently reports `Saved` / `They have been told.` after an operator decision
(`artifacts/sikshya/app/(admin)/person/[id].tsx`). A credential approval is sent as
`Your citizenship was approved.` from `artifacts/api-server/src/routes/admin.ts`. The first is
casual and ambiguous; the second falsely sounds like Sikshya or a government authority approved
the person's citizenship rather than accepting one submitted document for Sikshya's review.

### Required language and behavior

- After a teacher-account access decision, say exactly what happened, for example:
  `Teacher access approved. The teacher was notified by email and in Sikshya.`
- After a document decision, say exactly what happened, for example:
  `Document review saved. The teacher was notified by email and in Sikshya.`
- Delivery truth must come from the mail result. Never claim an email was sent if delivery
  failed; use `The decision was saved, but the email could not be delivered.` and keep the
  in-app notification outcome separate.
- Credential acceptance should use `accepted for Sikshya's teacher verification` or
  `document accepted`, never `citizenship approved`, `identity approved`, or a claim that the
  issuing government document is authentic.
- Suggested accepted-document subject:
  `Sikshya document review update`
- Suggested body:
  `The citizenship document you submitted has been accepted for Sikshya's teacher verification.
  This document decision is one part of the review; it does not by itself activate teacher
  access. We will notify you separately when the account review is complete.`
- Rejection must name the submitted document type, include the operator's reason, say that a
  replacement may now be uploaded, and avoid judgmental language.
- Teacher account approval is a separate message:
  `Your Sikshya teacher account has been approved. You may now choose a teaching plan.`
- Update UI, email, in-app notification, tests, and activity-log expectations together.

### Acceptance checks

- Approve one credential while the account remains pending: both channels say the document was
  accepted, but neither claims teacher access is active.
- Approve teacher access: both channels describe account approval, not document approval.
- Reject a credential: the exact operator reason appears and upload becomes available again.
- Simulate mail failure: the decision remains saved and the operator is not told email succeeded.

---

## 2. Lock teaching plans before operator approval

### What is already correct

The server gate in `artifacts/api-server/src/lib/teachingAccess.ts` is authoritative. Both email
verification and `teacher_profiles.approval_status === 'approved'` are required by
`mayBuyTeacherPlan()`. Preserve it and its use in the ordinary and monthly plan routes.

### Problem observed

`artifacts/sikshya/app/(teacher)/subscription.tsx` still lets a pending/rejected teacher select a
tier and open the simulated payment sheet. The refusal arrives only after phone/PIN entry. That
is late, confusing, and makes the screen look willing to take money it cannot accept.

### Required UI

- Derive eligibility from authenticated server-backed profile/security state; do not introduce a
  client-only source of truth.
- If email is unverified, lock every tier and payment CTA and show:
  `Verify your email before choosing a teaching plan.`
- If operator review is pending, lock every tier and payment CTA and show:
  `A Sikshya operator must approve your teacher account before you can choose a teaching plan.`
- If rejected, lock every tier and payment CTA and link the teacher to the document/profile area
  with the next corrective action.
- Locked cards must look disabled, expose an accessibility disabled state, and remain readable.
  No tap may open the payment sheet.
- Keep the server rejection for direct API calls, stale clients, and deep links.
- Do not conflate document acceptance with account approval.

### Acceptance checks

- Pending, rejected, and unverified accounts cannot select a tier or open payment.
- An approved, email-verified account can choose a tier.
- Calling the subscribe endpoint directly as a pending teacher still returns the existing 403.

---

## 3. Password-reset UX and security

### Current evidence

- The current link-token path in `artifacts/api-server/src/lib/accountSecurity.ts` declares a
  30-minute lifetime, stores only a SHA-256 token hash, checks `expires_at >= now()`, and marks
  unused tokens used after success.
- `POST /auth/password/forgot` already returns the same generic response whether an email exists.
- The owner successfully used what appeared to be a two-day-old reset link. Treat that as a real
  defect report. Do not merely change copy: reproduce and identify whether the link was from the
  new `account_tokens` flow, the older operator reset-code flow, a stale production API/build, a
  timezone/schema problem, or a deployment mismatch.
- `forgot-password.tsx` leaves the form and active button visible after success.
- `reset-password.tsx` has no show/hide controls and the server does not reject the current
  password as the new one.

### Required behavior

- Keep the generic account-enumeration-safe response:
  `If an account exists for that email, we will send a password reset link.`
- After a successful request, replace the input/button with a confirmation state. Do not keep an
  immediately active `Send reset link` button.
- Provide a controlled `Resend email` action only after a visible 60-second cooldown. Enforce
  the cooldown on the server as it is today; the timer in the UI is not security.
- Reset links expire **30 minutes after issuance**, server-side. They are one-time use. Issuing a
  new reset token invalidates every older unused reset token for that user.
- Compare the proposed password with the user's current password hash inside the reset
  transaction. Reject equality with a plain message such as
  `Choose a password different from your current password.` Never compare hashes directly,
  because password hashes use salts; use `verifyPassword`/bcrypt comparison.
- On a successful reset, invalidate all other unused reset tokens and decide explicitly whether
  existing login sessions need revocation. The current JWT model may require a new session
  version/revocation mechanism; do not pretend JWTs were revoked if they were not.
- Add show/hide controls to both New password and Confirm password fields, with accessible labels
  that change between `Show password` and `Hide password`.
- Do not put the token in logs, analytics, activity details, error monitoring, or tests' snapshots.
- Preserve the distinction between the newer emailed link flow and the legacy operator-issued
  reset-code route. If the operator code remains, document its purpose; do not silently make it
  another never-expiring back door.

### Required tests

- Unknown and known emails receive indistinguishable HTTP responses.
- A token works once before 30 minutes, fails after 30 minutes, and fails on second use.
- A second issued token invalidates the first.
- The current password is rejected as the new password; a different valid password succeeds.
- A concurrent double-submit produces exactly one successful password update.
- UI success state hides the email field and submit button; resend appears only after cooldown.
- UI show/hide buttons work independently and are keyboard/screen-reader accessible.

---

## 4. Safe test access without fake payment

### Owner intent

During product testing, the owner needs selected teacher accounts to create sessions and enter
the whiteboard without paying a real teaching-plan charge. This is temporary test access, not a
request to weaken approval or payment for every user.

### Required design

- Do **not** make `subscriptionActive` true for all teachers, accept a magic client flag, hardcode
  the owner's email, treat production as development, or let the payment mock create a real-looking
  receipt.
- Prefer an operator-granted server-side **test teaching entitlement** in a separate table (a new
  table is safer than a new column under this deployment model). It should contain teacher ID,
  tier/allowance, granted by, reason, granted at, and an expiry (`valid_until`). Record grant and
  revoke actions in the activity log.
- Only an email-verified, operator-approved teacher may receive/use it. It bypasses payment only;
  it must not bypass email verification, credential review, teacher ownership, membership,
  session limits, booking atomicity, refunds, or classroom permissions.
- The operator UI must make the action explicit and revocable. Default expiry should be short
  (for example seven days), with no silent permanent entitlement.
- Teacher UI must show a persistent `TEST ACCESS — no payment was processed` label and expiry.
  Test sessions/payments must not appear as revenue or paid production sales.
- The access decision must be made by the server in the same shared teaching-access layer used by
  every class-creation route. No screen-only bypass.
- Add an environment kill switch such as `ALLOW_TEST_TEACHING_ACCESS`; default false. Even when
  true, it only honors explicit unexpired operator grants. Before public launch, turn it off and
  confirm no active test grants remain.

### Acceptance checks

- Ordinary users in production still cannot bypass payment.
- One explicitly granted, approved test teacher can create sessions until expiry and still obeys
  the tier's session allowance.
- Revocation/expiry takes effect server-side on the next protected action.
- A pending or unverified teacher remains blocked even if a stale grant exists.

---

## 5. Disable inaccurate automatic shape conversion

**Status: implemented on the isolated shape-recognition-disabled branch; awaiting preview and
owner verification before production integration.** The active `SmartBoard.web.tsx` no longer
imports or calls the recogniser. The standalone research module and tests remain.

### Problem observed

The recognition pass in `artifacts/sikshya/components/SmartBoard.web.tsx` calls
`recognizeShape()` after freehand strokes. It has now failed a real teacher usability test:
ordinary writing, including the first stroke of a handwritten `A`, can be replaced by an arrow
or unintended shape.

### Required change

- Stop automatic replacement of freehand strokes in every teacher and student classroom.
- Preserve normal Excalidraw freehand drawing and its explicit line, arrow, rectangle, ellipse,
  diamond, and text tools.
- Prefer removing the recognition hook from the active path or putting it behind a compile-time
  default-off experimental flag. Do not expose a mysterious end-user setting in this slice.
- It is acceptable to retain the isolated recognition implementation/tests for future research,
  but no production stroke may be auto-converted.
- Update `WHITEBOARD.md`, `HANDOVER.md`, tests, and any copy that claims automatic recognition is
  active.

### Acceptance checks

- Scribbled letters, straight-ish freehand lines, circles, and rough shapes remain exactly as
  ink.
- Explicit Excalidraw shape/arrow tools still create those shapes.
- Board sync, undo/redo, attachments, pointer handling, and performance do not regress.

---

## 6. Honest call-window controls

### Current design and observed defect

Both classroom files have four app-owned states (`hidden`, `small`, `medium`, `full`) and keep
the same `VideoCall` mounted. The header's minus/plus control currently toggles `small` and
`medium`; the owner experienced the minus button as doing nothing. The separate HUD Show/Hide
behavior is useful and must remain.

### Required state semantics

- **Hidden:** call remains joined but its video window does not intercept whiteboard touches;
  the HUD says `Show call`.
- **Compact/minimized:** snap a genuinely small preview to the bottom-right safe corner. It must
  leave the whiteboard usable and offer an obvious Restore control. It is a preview, not a place
  to expose a row of unusable provider controls.
- **Normal:** draggable, resizable call window large enough to operate mic, camera, reactions,
  raise hand, people, and teacher screen share.
- **Full:** largest safe-area-bounded call view for a shared screen, with Restore.
- The top minus must always transition Normal/Full to Compact and visibly snap to the bottom-right.
  If this distinct behavior cannot be made reliable, remove that duplicate button; never ship a
  control whose icon promises an action that has no visible effect.
- The header maximize/restore button toggles Normal and Full. Show/Hide restores the last
  non-hidden size. Drag/resize state must be clamped on viewport rotation/resize.
- Maintain `pointerEvents="box-none"` on transparent overlay containers; only the window and
  visible controls capture touches. Keep chat/HUD/video z-indexes separated.
- Never enable Daily's internal floating/PiP window or built-in chat. There must be one Sikshya
  call window and one Sikshya socket chat.
- Do not remount or leave the call when hiding, minimizing, resizing, or switching to chat.

### Acceptance checks on laptop and a budget Android-sized viewport

- Every state transition is visible and reversible.
- Compact snaps bottom-right and no longer obscures a large portion of the board.
- Whiteboard remains drawable outside the visible call window in every non-full state.
- Daily controls are operable in Normal/Full; a teacher's shared screen is readable in Full.
- Teacher and student use the same window-state model, with student-safe actions only.

---

## 7. Parallel Stream Video proof of concept (Alternative #2)

The existing research in `video-provider-research-2026-08-28.md` selected **Stream Video** as the
strongest no-production-impact first experiment and closest controllable replacement. Daily must
remain active while this is developed and evaluated. This is not authorization to create a paid
account, enter billing details, change DNS, set production secrets, or switch production.

### Isolation

- Create a separate branch/worktree from the latest tested Claude branch, for example
  `claude/stream-video-poc`. Do not mix it with corrections 1–6.
- Keep `VIDEO_PROVIDER=daily` as the production/default provider.
- If Stream credentials/free development access are unavailable, finish the provider adapter,
  UI contract, fake-provider tests, and setup instructions, then stop at the exact credential
  boundary. Do not ask the owner technical questions that can be answered from the repo/docs.
- Before using any external service, re-check its current official free-tier limits and terms.
  Do not incur cost.

### Architecture

- Implement the server adapter under `artifacts/api-server/src/lib/video/` and register it in
  `index.ts`; preserve `ensureRoom`, `joinToken`, server-decided `isOwner`, and the existing room
  membership/time gates.
- Extend the provider contract only for real cross-provider capabilities required by the UI;
  never leak Stream-specific objects into the classroom screens.
- Add a platform-split Stream component behind
  `artifacts/sikshya/components/VideoCall.tsx`. The two classroom screens should continue to ask
  for a provider-neutral call.
- Sikshya owns the window shell and layout. The provider supplies media and call state.
- Sikshya's WebSocket remains authoritative for whiteboard, presence, attendance, lifecycle,
  unread badge/buzz, and the one class chat. Disable/omit provider chat and provider PiP.

### Minimum parity target

- Teacher: join/leave/end-for-everyone, mic, camera, device selection where available, reactions,
  raise/lower hand, participant list, mute participant/moderation, and screen share.
- Student: join/leave, mic/camera according to permissions, reactions, raise/lower hand,
  participant list, receive teacher screen share, no end-session authority.
- Existing Sikshya hidden/compact/normal/full window state works without remounting.
- Reconnect after transient network loss; degrade video before audio; default to bandwidth-safe
  camera quality and avoid subscribing to tracks that are not visible.
- Cheap-Android constraints: no heavy animations, bounded participant rendering, measurable
  memory/battery/network behavior, and usable controls at phone width.
- Privacy/security: short-lived server-minted user/room tokens, least privilege, no secrets in
  Expo/public bundles, no client-asserted teacher role, and redacted logs.

### Test and evidence gate

- Run the existing provider contract suite plus new tests against Daily, echo, and Stream/fake
  Stream. Daily behavior must remain unchanged.
- Test teacher laptop + student Android-sized viewport, reconnect, denied permissions, screen
  share, unread chat, hide/minimize/restore/full, and teacher-leaves-first teardown.
- Measure time to first media, reconnect time, received bitrate, CPU/memory where tooling permits,
  and failure behavior under throttled/poor network. Record what was measured versus inferred.
- Produce a preview or local two-device test guide and a parity matrix. Do not recommend a
  production switch until the owner has manually approved usability and current cost has been
  recalculated from measured resolution, minutes, and concurrency.

---

## Required verification for implementation slices

Use the narrow tests for the changed area, then before any preview/merge claim run:

```text
pnpm run typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/sikshya run test
pnpm --filter @workspace/sikshya run lint:design
```

Run `lint:design:update` only after a deliberate token cleanup lowers the baseline; never use it
to bless a regression. Manually verify every changed flow in the branch preview. Record exact
commands, results, preview URL, commit, deployment/run ID, failures, rollbacks, and deliberate
omissions in a dated `.agents/worklog/` entry.

## Explicitly not authorized by this packet

- No production provider switch and no Daily removal.
- No purchase, billing details, paid plan, DNS change, or external account creation.
- No weakening of email verification, operator approval, membership, booking atomicity, session
  allowances, refunds, or role permissions.
- No fake payment/revenue record presented as real.
- No production deploy without the owner's preview approval.
