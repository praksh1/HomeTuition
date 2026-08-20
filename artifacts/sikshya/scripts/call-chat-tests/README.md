# The chat inside the call

E12 asked for Daily's chat instead of the app's own. That is the one change
`.agents/memory/one-chat-per-class.md` says not to make, and the reason has not gone away: the
native app has no Daily Prebuilt, so switching Prebuilt's chat on gives a class with one laptop
and one phone **two conversations that cannot see each other**, with both sides looking like
they work.

What the request actually meant in practice — chat you can read without leaving the lesson —
did not require Daily's chat. The native app already had the class conversation inside its call
UI. The web did not: chatting meant switching to a tab that hid the video completely. So the
same messages are now rendered over the Daily iframe on web too. One conversation, in the call,
on both platforms.

## Running them

From `artifacts/sikshya`:

```
pnpm.cmd run test:call-chat
```

Needs Playwright, the same way the whiteboard tests do. No API and no build required: the
component is bundled on its own with esbuild and mounted in a page, with the test playing the
part of the classroom socket on both sides — pushing messages in, and reading back what the
panel tried to send.

It runs for about 25 seconds, because one check has to wait out the call's join deadline.

## What they cover

| Test | The failure it would catch |
|---|---|
| There is a chat control on the call | Chat only reachable by leaving the call — the reported problem |
| A call that will not connect says so | A black rectangle with no explanation (see below) |
| ...and chat is still reachable | A failed call taking the conversation with it |
| Messages arrive, with an unread count | A panel that only shows what you sent |
| Sending is handed to the classroom socket | Messages going into Daily instead, splitting the class |
| An empty message is not sent | Blank bubbles from a stray Enter |
| The call is still mounted while chatting | Tearing down the call to chat, which drops you out of the lesson |

## A finding worth keeping

Daily's `join()` **does not reject when the room cannot be reached** — it never settles at all.
Pointed at an unreachable room it sat there indefinitely, and the classroom showed a black
rectangle with nothing to read and nothing to do. On the connections this product is built for
that is not an edge case. There is now a 20-second deadline, after which the call says it is
still trying and points out that the board and chat work meanwhile; if the call does come up
later, the message goes away by itself.

## Proving they work

- `showChat` forced to false — the two chat-control checks went red.
- The join deadline raised to an hour — the two "says so" checks went red.

Each restored the suite to 17 passed, 0 failed.
