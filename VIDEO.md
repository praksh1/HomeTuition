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

## The LiveKit trial

**Status: written and checked, never run against a live LiveKit server. Not deployed.**

LiveKit Cloud is built and sits beside Daily rather than replacing it. Daily is untouched and
remains the default; the whole trial is reversible by one environment variable.

### Turning it on and off

```
VIDEO_PROVIDER=livekit     # try it
VIDEO_PROVIDER=daily       # or leave unset — back to today, no rebuild
```

Plus three credentials from the LiveKit Cloud project, on the API server only:

```
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_URL=wss://<project>.livekit.cloud
```

All three or none. A half-configured provider mints no token rather than half-working, because a
token signed for a server nobody can reach fails in a way that looks like a network fault to
everybody involved.

**`LIVEKIT_API_SECRET` never leaves the server.** It signs a JWT in
`lib/video/livekitProvider.ts` and nothing else. What reaches a browser is that signed token and
the `wss://` address. Anyone holding the secret could mint themselves a token for any room in
the project, including a class they never paid for, so `scripts/video-tests` asserts the secret
appears in no response body.

### It is web only, and that is measured rather than assumed

The Android and iOS apps stay on Daily. Daily and LiveKit each ship their own fork of the same
native WebRTC library: 33 Android classes and 47 iOS classes appear in both, and both declare the
Android namespace `com.oney.WebRTCModule` and register the React Native module under the name
`WebRTCModule`. One app build cannot contain both, and neither SDK can be installed without its
fork — each requires it as a peer dependency.

So while the trial runs, **do not point a phone build at a deployment set to `livekit`.** A phone
that reaches a LiveKit room lands on `components/LiveKitEmbed.tsx`, which says video is
unavailable in the app and that the board and chat still work. That is the honest failure, not a
working call.

### Built for a weak connection

Four settings, all in `artifacts/sikshya/lib/video/livekit.ts`:

- **480p and no higher**, on capture and on publish — 640×480 at 500 kbps. A 720p camera costs
  roughly three and a half times that and looks no better in a 200-pixel tile.
- **Simulcast**, three layers (180p / 360p / 480p). One student on a weak line receives a smaller
  layer instead of dragging the resolution down for the whole class.
- **Adaptive stream** — a small tile gets a small layer; a tile scrolled out of sight gets
  nothing until it comes back.
- **Dynacast** — a layer nobody is watching stops being encoded and sent. In a class where
  everyone is looking at the whiteboard, that is most of the teacher's upstream traffic saved.

Audio is set to a speech preset at 24 kbps rather than the SDK's music default, and the codec is
VP8 because it is the one every Android browser in this market decodes in hardware.

**Audio-only mode** turns video off in both directions — it stops this person publishing a camera
*and* unsubscribes from everyone else's, which is the larger half of the traffic in a class of
nine. The whiteboard and the audio are untouched; the lesson carries on without faces. A shared
screen is deliberately kept, because it is content rather than a face — the same reason the board
stays.

### What has actually been checked

| Checked | How |
|---|---|
| Tokens are minted server-side, correctly scoped | `api-server` `scripts/video-tests` — 34 checks, including that the secret and key appear in no response |
| A teacher gets moderator rights and screen share; a student gets neither | same suite, decoding the JWT's claims |
| An unconfigured LiveKit fails honestly | same suite — no silent fallback, no unsigned token, no variable name leaked |
| Room naming still correlates provider evidence to a class | `src/lib/video/roomName.test.ts`, which reads `lib/daily.ts` as source and fails if the two rules drift apart |
| The call surface at phone and laptop width | `sikshya` `scripts/livekit-tests` — 74 checks in a real browser |
| Reconnection, refused camera, microphone in use, blocked sound, a teacher leaving | same suite, each state driven deliberately |
| Controls are at least 44×44 and do not run off a narrow panel | same suite, measured from the rendered boxes |
| Daily and the whiteboard still behave | `test:board` 44/44, `test:call-chat` 17/17, `test:call-leave` 9/9 |

### What has not been checked, and cannot be here

- **No media has ever flowed.** No camera has been opened, no packet sent, no token presented to
  a LiveKit server. `scripts/livekit-tests` bundles the real component over a fake provider,
  precisely so the failure states can be produced on demand — it proves the interface, not the
  call.
- **A genuine two-person call.** That needs the credentials and two browsers. It is the first
  thing to do.
- **Behaviour on a real phone browser**, which is the market this is for.
- **`docs.livekit.io` is blocked** by this environment's network egress. Everything is written
  against the installed SDK's own TypeScript definitions and source, which are authoritative for
  the API surface but say nothing about behaviour under a real network.

### Two instructions that collided, and how

The brief asked for a single video abstraction that both providers implement, and — in the same
breath — that no Daily code be modified so the owner could switch back instantly.

Those cannot both be had. `DailyEmbed` is a self-contained React component that owns its own call
object and renders Daily's own iframe UI; giving it the imperative interface (`joinRoom`,
`toggleMic`, `getParticipants` …) would mean restructuring exactly the code that must not move.

The resolution, stated plainly rather than done quietly: **the imperative module
(`artifacts/sikshya/lib/video/`) is implemented for LiveKit only, and `components/VideoCall.tsx`
remains the switch.** The guarantee the brief was actually after — that no screen imports a
provider by name — still holds: `VideoCall` is the only file that names either one, and it was
already built that way. If Daily is retired, the second implementation becomes worth writing;
while it is the fallback, moving it is the risk the instruction existed to avoid.

## Two things not to break on the way

- **Rights are decided here, not there.** `isOwner` is passed in. A provider that works it out
  for itself is a provider that can be talked into it by a client.
- **The app keeps its own chat.** The provider's built-in chat splits a class in two: it
  disappears when the call ends and it cannot reach somebody who has not joined yet. This app's
  chat is on its own socket and is written down. `builtInChat` describes the provider; it is not
  an instruction to use it.
