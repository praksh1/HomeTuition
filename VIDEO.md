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

Two things. That is the whole contract — `artifacts/api-server/src/lib/video/types.ts`.

```ts
ensureRoom(sessionId): Promise<string>            // where to join
joinToken(sessionId, { isOwner, userName }): Promise<string | null>   // who may join it
```

Plus a name, a `configured()` check, and a statement of what it can do (`screenShare`,
`builtInChat`).

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
| Built here | your own URL | your own token |

## Doing it

1. Write `artifacts/api-server/src/lib/video/<name>Provider.ts` implementing `VideoProvider`.
2. Add it to `PROVIDERS` in `artifacts/api-server/src/lib/video/index.ts`.
3. If it needs its own call UI, add a branch to `artifacts/sikshya/components/VideoCall.tsx`.
   An iframe-based provider may need nothing — point it at the existing embed.
4. Set `VIDEO_PROVIDER=<name>` on Railway.

Nothing in the routes changes. Nothing in the classroom screens changes.

## Checking it

`pnpm --filter @workspace/api-server run test:video` starts the real server twice — once on
Daily and once on `echo`, a provider that carries no video and exists only for this — and
checks that every rule around the room is identical either way: who may have one, when the door
opens, and who gets moderator rights.

That last one is the one to watch. **Moderator rights come from the server's own membership
check, never from the client and never from the provider.** A swap that quietly handed every
student the teacher's powers would be a bad day; there is a test that says it does not.

Point the suite at your new provider by adding it to `PROVIDERS` and running with
`VIDEO_PROVIDER=<name>`.

## Two things not to break on the way

- **Rights are decided here, not there.** `isOwner` is passed in. A provider that works it out
  for itself is a provider that can be talked into it by a client.
- **The app keeps its own chat.** The provider's built-in chat splits a class in two: it
  disappears when the call ends and it cannot reach somebody who has not joined yet. This app's
  chat is on its own socket and is written down. `builtInChat` describes the provider; it is not
  an instruction to use it.
