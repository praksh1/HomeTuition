# The owner's review of 2026-08-25

Everything raised in one message after a long testing session, written down before any of it is
acted on. Three container resets had already lost a working tree that day; a list this size
living only in a chat is a list that gets half-done.

**Ordering is mine, and deliberate.** Broken things a real person hits come before questions
about design, which come before rebuilds. Where the owner asked a question, the answer is
researched from the code rather than guessed — they asked for a review, not options.

---

## A. Broken now

| | What | Where |
|---|---|---|
| A1 | **Downloading an attachment fails.** Uploads work; opening one afterwards does not. Tapping it navigates the browser to the raw `…r2.cloudflarestorage.com` address. | `lib/fileStore.ts` `signView`, `routes/storage.ts` `GET /storage/file` |
| A2 | **The Sessions tab filters do not work.** The list "blinks and shows something, but then it disappears." Screen recording supplied. | `app/(student)/sessions.tsx`, `app/(teacher)/sessions.tsx` |
| A3 | **No way to sign out of the support desk.** | `app/(admin)/` |
| A4 | **"My Requests" is an unlabelled icon** in the corner of Customer Support. The owner could not find their own requests. | `app/support.tsx` |

## B. The monthly tier, reviewed

Seven questions. Several are rule decisions rather than bugs, and the answers must come from
what the code actually does today.

1. Should a student who joins mid-month see chat from before they enrolled?
2. A monthly class should link straight to **today's session**. Neither side should have to go
   to the Sessions tab to attend.
3. A student is told "you paid NPR 1,933 for 29 classes"; a teacher owes a minimum of 25. Two
   different numbers for one arrangement — does that create refund disputes? Should both read
   30, make-ups included?
4. A teacher going out of town in two weeks: can they schedule make-ups for while they are away?
5. Bhadra has ~17 working days before the festival season. **Can a teacher run a class for only
   those days?** The owner asked for brainstorming and an implementation, not a yes/no.
6. A student who misses several sessions and then drops out mid-month — is there a rule? What
   should it be?
7. Joining a recurring session opens a classroom with its own chat. **Is that the same
   conversation as the monthly class chat, or a second one?**

## B2. What the owner decided, 2026-08-26

Answers given, in their order:

1. **Chat before enrolling** — hide it from late joiners, *but* let the teacher **pin** messages
   that stay visible to everyone whenever they joined.
2. **Link to today's session from the monthly class** — build it. Started first.
3. **29 vs 25** — agreed: show what was paid for and what is guaranteed. Implement.
4. **Make-ups while the teacher is away** — make it work.
5. **A month that is not a whole month** — parked. Full detail, and the decisions needed before
   it can start, in `monthly-partial-months-and-dropping.md`.
6. **Dropping the whole course mid-month** — parked, same file.
7. **Two chats** — the owner's worry is people writing in one and being answered in the other:
   *"I just don't want this to be confusing."* One conversation per class, however it is
   reached, is the thing to aim at.

Also: **Messages** is not meant to be WhatsApp entire — a conversation-style thread with
attachments is what was asked for.

## C. Messages, rebuilt to look like a messaging app — **done**

The owner's words: no Inbox/Sent/Drafts. One list, newest correspondent on top, unread marked,
open to clear it. Unsent text stays a draft. Sent and received in different bubbles, a few
reactions. "As close to Messenger/WhatsApp/Viber as possible" — and explicitly: replace their
wording with whatever the industry actually does.

Built: folders gone, one list newest-first, drafts shown against the conversation they belong
to, a paperclip on the compose row, long-press to react. 52 checks in
`artifacts/api-server/scripts/message-tests/run.mjs`, each guard removed on purpose to confirm
its check goes red.

One thing found along the way that had nothing to do with Messages and everything to do with
the next feature that stores a file: `GET /storage/file` allows a fixed list of cases, and a
recipient of a message was not on it — so a photo sent to a teacher produced a bubble they
could see and a file they could not open. Written up in
`.agents/memory/attachment-access-is-per-feature.md`, because the same trap is waiting for
whatever stores a file key next.

## D. Infrastructure the owner asked about

- **Fewer services.** They log into 4-5 separate things and expect to lose track. Prefer one
  free, central provider where possible; revisit nearer launch.
- **An API gateway**, to make the app faster and smoother.

Both need a real answer rather than agreement. Today: Railway (API), Cloudflare (site + R2),
Neon (database), Daily (video), GitHub. Whether that is worth consolidating, and whether a
gateway helps or is a layer that earns nothing here, is C-level advice the owner is asking for
honestly — so it needs measuring, not opinions.
