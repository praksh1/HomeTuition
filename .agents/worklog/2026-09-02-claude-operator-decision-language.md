# Professional operator decisions and truthful delivery reporting

- Date: 2026-09-02
- Agent: claude
- Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Base commit: `9578b76` (packet `b40407d`)
- Status: complete — awaiting owner preview approval before merge

## Requested

Section 1 of `.agents/backlog/2026-09-02-owner-corrections-and-stream-poc.md`. Separate document
acceptance from teacher-access approval, stop describing an uploaded citizenship document as
"citizenship approved", and never claim an email was delivered when it was not.

## Changed

**`artifacts/api-server/src/lib/accountNotices.ts`** — new. Pure, import-free string composition
for the four operator decisions, so the wording is unit-testable without a database, mail provider
or running server. Exports `FORBIDDEN_PHRASES` (the phrases this project has promised never to
send again, each with its reason), `documentDecisionNotice()`, `teacherAccessDecisionNotice()`,
`EmailOutcome`, and `deliveryLine()`.

**`artifacts/api-server/src/lib/accountNotices.test.ts`** — new, 10 tests. The first one asserts
every notice the module can produce against every banned phrase, so adding a phrase to the list
automatically covers all notices.

**`artifacts/api-server/src/lib/notify.ts`** — added `notifyInApp()`, which pushes to the app
without sending email, for notices whose email the calling route owns and awaits.

**`artifacts/api-server/src/routes/admin.ts`** — added `deliverDecision()`; rewrote both
`POST /admin/teachers/:userId/decision` and `POST /admin/teacher-credentials/:id/decision` to use
the new wording, await the email, and return `notified: { email, inApp, message }`. The delivery
outcome is now also written into the activity log.

**`artifacts/sikshya/app/(admin)/person/[id].tsx`** — replaced `Saved` / `They have been told.`
with `Teacher access approved.` / `Document review saved.` plus the server's own delivery
sentence. Added the `DecisionResult` interface.

**`artifacts/api-server/scripts/admin-tests/run.mjs`** — six new checks covering the packet's
acceptance criteria.

## Decisions and assumptions

- **The operator sentence is composed on the server**, not in the app. The app already keeps a
  second copy of the tier price table and that is logged as a financial hazard; a second copy of
  "we emailed them" would be the same mistake in a smaller place.
- **Transactional notices are not preference-gated.** `notifyInApp()` deliberately skips the
  preference check. Nobody opts out of being told the outcome of their own application, and the
  old path *was* gated — a teacher who had turned chat emails off was never told their account
  decision at all.
- **I did not use the packet's suggested operator string verbatim.** It proposed `The teacher was
  notified by email and in Sikshya.` That sentence cannot be true as stated (see the next section),
  so I followed the packet's stated rule — delivery truth must come from the result — over its
  example. `deliveryLine()` distinguishes `sent`, `failed` and `not_configured`, and describes the
  in-app half separately and accurately.
- Rejection subjects carry `— action needed` so the teacher notices; the body names the document,
  quotes the reviewer's reason, and says the upload is open again, with no judgement of the person.

## Verification

Every command was run from `/home/user/HomeTuition` against a local Postgres 16 on port 55432
(the container had rolled back; cluster re-created with `initdb`, schema applied with
`pnpm run db:push`).

| Command | Result |
|---|---|
| `pnpm run typecheck` | clean, all four packages |
| `pnpm --filter @workspace/api-server run test` | **279 passed, 0 failed** |
| `pnpm --filter @workspace/sikshya run test` | **154 passed, 0 failed** |
| `pnpm --filter @workspace/sikshya run lint:design` | no new leaks; baseline unchanged at 223 hex / 429 sizes |
| `node scripts/admin-tests/run.mjs` (live server + live DB) | **58 passed, 0 failed** |

The six new integration checks that passed against a running server:

- accepting a document leaves the account pending
- the operator is told what happened to the email
- and is not told an email was sent when none was
- the decision is still saved when no email could go
- the account decision also reports its delivery
- and the delivery outcome is written to the activity log

Because no mail provider is configured locally, that run also covers the packet's "simulate mail
failure" case: the outcome came back `not_configured` and the operator sentence does not contain
"was emailed".

I also printed the finished notices end-to-end. The accepted-document email now reads:

> **Sikshya document review update** — The citizenship document you submitted has been accepted
> for Sikshya's teacher verification. This document decision is one part of the review; it does
> not by itself activate teacher access. We will notify you separately when the account review is
> complete.

## Problems and surprises

**Two defects the packet did not know about, both found by reading `notify()`:**

1. **The credential route was sending two emails.** `notify()` maps `kind: "message"` to a real
   email — subject "New message from Sikshya Support", body quoting the decision as if a person
   had typed it in a chat, and a link to `/conversation/undefined` because these support notices
   carry no `fromUserId`. The route then sent its own. A teacher whose document was reviewed
   received both. Fixed by routing the in-app half through `notifyInApp()`.

2. **The teacher-account decision route sent no purpose-written email at all.** Its only mail was
   that same chat-shaped one, gated on the teacher's *message* email preference — so a teacher who
   had turned chat emails off was never told the outcome of their application. It now sends its own
   awaited email.

**A limitation that is now stated rather than papered over:** there is no server-side notification
store. `notifyUser()` writes to live sockets only, and the app keeps its list in AsyncStorage. A
teacher whose app is closed receives **nothing** in-app — only the email reaches them. So
"notified in Sikshya" is not a claim the server can make, and `deliveryLine()` says "they will see
it when they next open the app" instead. Fixing this properly means a notifications table, which is
a schema change and belongs in its own slice.

## Fabrications found

Three, all in the operator/notification path:

| Where | The fabrication |
|---|---|
| `(admin)/person/[id].tsx` | "They have been told." — asserted after a fire-and-forget email whose result was discarded. On a server with no mail provider configured, nothing was sent and the operator was told it had been. |
| `admin.ts` credential decision | "Your citizenship was approved." — Sikshya accepted a copy of a document for its own check; it does not approve anybody's citizenship and has no standing to say so. |
| `admin.ts` account decision | "Your teaching credentials have been approved. You can schedule classes now." — wrong on both halves: it announced a *document* outcome for an *account* decision, and an approved teacher still cannot schedule anything until they hold a teaching plan. |

Added to the running table in `.agents/backlog/ui-upgrade-progress.md`.

## Deliberately not changed

- **`mayBuyTeacherPlan()` and the server access gate.** Untouched; section 2 depends on it.
- **The preference model.** `notify()` behaves exactly as before for every other caller; only the
  two operator decisions were moved off it.
- **The `/conversation/undefined` link** in `notify()`'s message email. Real, but it belongs to the
  chat notification path rather than operator decisions, and fixing it here would widen the slice.
  Recorded in `HANDOVER.md` §8.
- **A server-side notification store.** A schema change; see above.
- **No email provider was configured, no production deploy, no migration beyond `db:push` against
  the local test cluster.**

## Remaining risks / next pickup point

- **Not yet verified in a browser preview.** The gate above is automated plus a live-server
  integration run. The operator screen's new confirmation text has not been looked at by a human.
  The owner should check it on the preview before this merges.
- **A previously approved teacher may hold the old wording** in their AsyncStorage notification
  list. Nothing clears it; it will age out.
- Next: section 2, locking teaching tiers before operator approval. `mayBuyTeacherPlan()` is
  already authoritative on the server — the work is deriving eligibility in
  `app/(teacher)/subscription.tsx` and preventing the payment sheet from opening.
