---
name: Daily's built-in chat is disabled on purpose
description: `enable_chat: false` in daily.ts is deliberate — re-enabling it splits a mixed browser/phone class into two conversations that cannot see each other.
---

`artifacts/api-server/src/lib/daily.ts` sets `enable_chat: false` on every room. It looks like
a feature switched off by mistake, and turning it back on is an easy, plausible "fix".

Do not. Here is what happens:

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

**How to apply:**
- Leave `enable_chat: false`. Chat belongs to the classroom socket, not to Daily.
- The same reasoning applies to any Daily feature that keeps its own state: if it does not
  exist identically on both platforms, it will split the class in two. Hand-raising and
  reactions are safe because they are transient signals rather than a shared history.
- When testing chat, always test with **one browser and one phone at once**. Two browsers, or
  two phones, will never reveal this class of bug.
