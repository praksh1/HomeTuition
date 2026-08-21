---
name: Daily's chat is on for web, and the app's own chat is off — the split is now a known, accepted cost
description: `enable_chat: true` in daily.ts was the owner's decision after testing on a phone. It buys a usable call and costs one thing: an installed app and a browser in the same class have two conversations that cannot see each other.
---

**This entry was reversed on 2026-08-21, deliberately.** It used to say Daily's chat must stay
off. The owner then used the app's own in-call chat on a phone, found it took over the screen
and could not be closed, and asked for Daily's chat instead. That is the current state:
`enable_chat: true` on the room, and `IN_CALL_CHAT_ENABLED = false` in `DailyEmbed.web.tsx`.

The reason the switch was off has not gone away, so here it is, still true:

- On **web**, Daily Prebuilt would supply its own chat panel, and messages would live inside
  Daily.
- On **iOS and Android**, the app uses the Daily SDK with a custom UI, and its chat is fed by
  the classroom WebSocket.

A class with one person on a laptop and one on a phone would then have **two separate
conversations, neither able to see the other**. Both sides look like they are working, which is
what makes it hard to diagnose from a bug report — each person sees their own messages sent
successfully and simply concludes the other is ignoring them.

**Why:** found while adding chat to the native app, which previously had none. The natural
implementation — Daily's chat on web, the app's on native — silently created this split, so
Daily's chat was turned off and the in-app chat tab was restored in both classrooms instead.
The app's own chat is the single conversation everywhere.

**Asked for again, and answered without breaking it.** The owner later asked directly for
Daily's chat (E12). The request was real; the mechanism was not. What they wanted was chat they
could read without leaving the call — on web, chatting meant a tab that hid the video. The app's
own chat is now rendered *over* the Daily iframe on web, which is what the native build already
did. Same conversation, inside the call, on both platforms, and `enable_chat` is still false.

If it is asked for again, this is the answer: put the app's chat where Daily's would have been.

**How to apply:**
- Leave `enable_chat: false`. Chat belongs to the classroom socket, not to Daily.
- The same reasoning applies to any Daily feature that keeps its own state: if it does not
  exist identically on both platforms, it will split the class in two. Hand-raising and
  reactions are safe because they are transient signals rather than a shared history.
- When testing chat, always test with **one browser and one phone at once**. Two browsers, or
  two phones, will never reveal this class of bug.


## What changed, and what to watch for

- `daily.ts` now sets `enable_chat: true`. Prebuilt supplies the chat on web.
- `DailyEmbed.web.tsx` sets `IN_CALL_CHAT_ENABLED = false`, so the app no longer draws its own
  panel over the call. The panel is **switched off, not deleted**, at the owner's request: it
  is what a call would need the day this project moves off Daily. Its tests still drive it via
  the `enableInCallChat` prop, so it cannot rot while it waits.
- The app's Chat **tab** is untouched and is still the chat on iOS and Android.

**The cost is not currently being paid, and comes due later.** Everyone is on browsers today,
so there is one chat per class in practice. The day the installed app reaches a store, a class
mixing an app user and a browser user has two conversations, both looking like they work.
Before that ships, one of these has to happen: bridge the two, or turn Daily's chat back off
and fix the app's own panel so it does not take over a small screen.
