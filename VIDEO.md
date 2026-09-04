# Replacing the video provider

Daily.co carries the audio and video today. It works, and it is very unlikely to survive the
monthly tier.

## Why this document exists

The monthly tier is forty-five students in a ninety-minute call, every day. That is roughly

    46 participants × 90 minutes × ~26 sessions ≈ 108,000 participant-minutes

per teacher per month, against a NPR 6,500 (~US$49) subscription. Daily bills per
participant-minute. Check your own rate before doing anything else, but the shape of the problem
does not depend on the exact number: **at that volume the tier can lose money on every teacher,
and lose more the more it sells.**

So the provider is behind a seam. Swapping it is one new file and one environment variable, not
a rewrite of every classroom screen.

## What a provider has to do

Two things, and one optional third. That is the whole contract —
`artifacts/api-server/src/lib/video/types.ts`.

```ts
ensureRoom(sessionId): Promise<string>            // where to join
joinToken(sessionId, { isOwner, userName, userId, durationMinutes }): Promise<string | null>
identityFor?(userId): string                      // what it will call that person, if anything
```

Plus a name, a `configured()` check, and a statement of what it can do (`screenShare`,
`builtInChat`).

`userId`, `durationMinutes` and `identityFor` arrived with the Stream experiment and none of them
is a Stream detail. Every candidate that mints its own token binds it to an identity, and the app
has to send back the *same* string or fail to authenticate; and every one of those tokens carries
an expiry, whose only honest input is how long the lesson lasts — a flat lifetime drops somebody
mid-class and refuses the rejoin. `identityFor` is optional, so Daily, which has no identities,
returns `null` in the room grant rather than being made to invent one. Daily ignores the other
two.

It is this small because **the provider carries audio and video and nothing else.** Presence,
chat, the whiteboard, the attendance record and the time limit all run over this project's own
WebSocket and are not the provider's business. That was already true, and it is why replacing
the provider does not touch any of them.

### Every serious candidate fits

| | `ensureRoom` returns | `joinToken` returns |
|---|---|---|
| LiveKit | the `wss://` server URL | a JWT with room, identity and grants |
| Jitsi | the room URL | a JWT, or null for an open instance |
| 100ms | the room URL | an auth token |
| **Stream** | **a locator, `stream:call/<type>/<id>?api_key=…` — it has no per-call URL** | **a JWT scoped to one call, valid an hour** |
| Built here | your own URL | your own token |

Stream is the one that stretched the shape, and it still fits: a string that says where to join
is a string whether or not it happens to be a link. See STREAM.md.

## Doing it

1. Write `artifacts/api-server/src/lib/video/<name>Provider.ts` implementing `VideoProvider`.
2. Add it to `PROVIDERS` in `artifacts/api-server/src/lib/video/index.ts`.
3. If it needs its own call UI, add a branch to `artifacts/sikshya/components/VideoCall.tsx`.
   An iframe-based provider may need nothing — point it at the existing embed.
4. Set `VIDEO_PROVIDER=<name>` on Railway.

Stream has been through all four, on `claude/stream-video-poc`, and STREAM.md is the write-up:
what it took, what it proved, and the native-dependency conflict that stops a phone test until
somebody decides about it.

Nothing in the routes changes. Nothing in the classroom screens changes.

## Checking it

`pnpm --filter @workspace/api-server run test:video` starts the real server three times — on
Daily, on `echo` (a provider that carries no video and exists only for this), and on `stream`
with no credentials — and checks that every rule around the room is identical each way: who may
have one, when the door opens, and who gets moderator rights.

Moderator rights are the one to watch. **They come from the server's own membership check, never
from the client and never from the provider.** A swap that quietly handed every student the
teacher's powers would be a bad day; there is a test that says it does not.

The third run adds two more things to watch. First the *order* the refusals come in: with an
unconfigured provider a member gets a **503** and no room, but somebody who never booked gets a
**403** and somebody signed out a **401** — the membership check runs before the provider is ever
consulted. If those ever swapped over, an unconfigured provider would look like an access control
and a configured one would quietly stop being one.

Second, what the refusal *says*. A server that was never set up answers 503 with a sentence about
video not being set up here; a provider having a bad minute keeps its 502. Which environment
variable is missing goes to the log and never into the response — there is a check for that, so
the convenience of putting it in the error message cannot creep back.

Point the suite at your new provider by adding it to `PROVIDERS` and running with
`VIDEO_PROVIDER=<name>`.

## Two things not to break on the way

- **Rights are decided here, not there.** `isOwner` is passed in. A provider that works it out
  for itself is a provider that can be talked into it by a client.
- **The app keeps its own chat.** The provider's built-in chat splits a class in two: it
  disappears when the call ends and it cannot reach somebody who has not joined yet. This app's
  chat is on its own socket and is written down. `builtInChat` describes the provider; it is not
  an instruction to use it.
