# The Stream Video experiment

**Nothing in this document changes how a class runs today.** Daily carries every lesson,
`VIDEO_PROVIDER` still defaults to `daily`, and every file described here is unreachable unless
somebody deliberately sets `VIDEO_PROVIDER=stream` on a server. This is an experiment behind the
seam `VIDEO.md` describes, written so the owner can decide about a migration on evidence rather
than on a marketing demo.

Written 4 September 2026, on branch `claude/stream-video-poc`.

---

## 1. Why there is an experiment at all

The monthly tier is forty-five students in a ninety-minute call, every day:

    46 participants × 90 minutes × ~26 sessions ≈ 108,000 participant-minutes

per teacher per month, against a NPR 6,500 (~US$49) subscription. Daily bills per
participant-minute. At that volume **the tier can lose money on every teacher, and lose more the
more it sells.** The full comparison of every candidate is in
`.agents/backlog/video-provider-research-2026-08-28.md`; that report chose Stream as the first
experiment because it is the closest controllable replacement — components rather than an
iframe, screen sharing on both phones, and moderation this server can drive.

## 2. Where the branch stops, and why

**It stops at the Stream SDK, not at credentials.** That turned out to be a harder boundary than
the one the packet anticipated, and it is worth stating plainly before anything else.

Stream's React Native SDK requires `@stream-io/react-native-webrtc`. Daily's requires
`@daily-co/react-native-webrtc`. Both are forks of the same library, and they collide:

| | Daily | Stream |
|---|---|---|
| Package | `@daily-co/react-native-webrtc` 124.0.6-daily.2 | `@stream-io/react-native-webrtc` 145.3.1 |
| Android native module name | `WebRTCModule` | `WebRTCModule` |
| Java classes with identical fully-qualified names | — | **33** shared with Daily's fork |
| iOS/macOS sources with identical names | — | **45** shared with Daily's fork |
| Prebuilt WebRTC | `org.jitsi:webrtc:124.+` | `io.getstream:stream-video-webrtc-android:145.9.0` |
| CocoaPods pod | `react-native-webrtc` (needs `JitsiWebRTC ~> 124.0.0`) | `stream-react-native-webrtc` (needs `StreamWebRTC = 145.15.0`) |

**Measured, not inferred.** The two packages' file lists were compared directly on 4 September
2026; `@stream-io/react-native-webrtc@145.3.1` was downloaded from the npm registry and
`@daily-co/react-native-webrtc@124.0.6-daily.2` read out of this repo's own `node_modules`.

Gradle refuses duplicate classes on the compile path and React Native cannot register two native
modules under one name, so **this is a build failure rather than a subtle bug** — which is the
good news. Nobody can ship it by accident.

The web SDK has no such problem: a browser already has WebRTC, so `@stream-io/video-react-sdk`
is ordinary JavaScript and would sit beside `@daily-co/daily-js` with nothing to collide. It is
still not installed here, for a different reason: it would land in the bundle every student
downloads over a Nepali mobile connection, for a provider that is switched off.

So this branch ships the **whole integration and none of the dependency**: the server adapter,
the app's call shell, the mapping from a Stream call object onto this app's session, and 86 tests
that drive all of it with fakes. What it cannot do is prove Stream behaves as its documentation
says. Section 6 is the exact list of what that costs.

## 3. What was built

### On the server

| File | What it is |
|---|---|
| `artifacts/api-server/src/lib/video/streamCall.ts` | Pure. Locator format, token claims, call settings, configuration errors, key redaction. Imports nothing, so it is unit-testable. |
| `artifacts/api-server/src/lib/video/streamProvider.ts` | The `VideoProvider`: `configured`, `ensureRoom`, `joinToken`, `identityFor`. |
| `artifacts/api-server/src/lib/video/index.ts` | Registers `stream`. `daily` is still the fallback. |
| `artifacts/api-server/src/lib/video/types.ts` | Two additions, below. |
| `artifacts/api-server/src/routes/sessions.ts` | Passes `userId` to `joinToken`; returns `identity` with the room. |

The provider contract grew by exactly two things, both genuinely cross-provider:

- **`JoinOptions.userId`** — every candidate that mints its own token binds it to an identity
  (LiveKit's `identity`, Jitsi's `context.user.id`, Stream's `user_id`). Daily ignores it.
- **`VideoProvider.identityFor?()` and `RoomGrant.identity`** — what the provider will call that
  person. Optional, so Daily returns `null` rather than being made to invent one. It lives on the
  provider rather than in the route so the identity a token is signed for and the identity the
  app sends back cannot be two different strings; that mismatch fails as an authentication error
  with nothing readable in it.

Nothing else changed. `VideoCapabilities` was deliberately *not* extended with flags for
reactions, raised hands or moderation: the classroom screens do not draw call controls — the
provider's own shell does, and it already knows which provider it is. A flag there would be a
fact the code already has.

### What a room looks like

`ensureRoom` returns a **locator, not a link**, because Stream has no per-call URL — its client
is handed an API key, a call type and a call id, and finds the edge itself:

```
stream:call/default/sikshya-42?api_key=<publishable key>
```

It does not pretend to be `https` on purpose. (The echo provider's `https://video.invalid/...`
still looks openable; this does not.)

**The API key travels in it deliberately.** Stream's API key is the publishable half of the pair
— the secret never leaves the server and is what signs tokens — so handing it over with the room
means **no Stream value is compiled into the Expo bundle at all.** A build of the app carries no
trace of the experiment, and turning the provider off at the server turns it off on every phone
already installed, with no rebuild and no store review.

### The join token

An HS256 JWT signed with `STREAM_API_SECRET`, minted per join:

```json
{ "user_id": "17", "call_cids": ["default:sikshya-42"], "role": "host", "iat": …, "exp": iat+3600 }
```

- **`call_cids` scopes it to one call.** Without it, a Stream token is a key to every call in the
  app — a student who booked one class would hold a credential for every other lesson on the
  platform. That is the door `lib/membership.ts` already closed one layer up and it is not being
  reopened underneath.
- **`role` is `host` only for the teacher who owns the session**, decided by
  `getSessionMembership`, never by anything the client says.
- **One hour**, which is Stream's own default and deliberately not the eight hours the Daily path
  uses. The token authenticates the join; the classroom re-fetches the room whenever it opens.

`role` is a *request*, not a grant — what `host` may actually do is configured against the call
type in Stream's dashboard. So the app is told `isOwner` separately and draws its teacher-only
controls from that. Two independent noes: a misconfigured dashboard cannot put an End button in
front of a student, and a tampered client cannot make Stream honour one.

### In the app

| File | What it is |
|---|---|
| `components/VideoCall.tsx` | Gains a `stream` branch. The Daily branch is byte-for-byte what it was. |
| `components/StreamCall.tsx` | Sikshya's window: controls, participant strip, status line, people sheet. One file for both platforms. |
| `components/stream/streamBridge.ts` | The line between Sikshya and Stream. Everything above it has never heard of Stream. |
| `components/stream/streamSession.ts` | Maps a Stream `Call` onto this app's session, and builds a client from whichever module a platform loaded. |
| `components/stream/streamSdk.ts` / `.web.ts` | The loaders. Both report their own absence today. |
| `utils/streamRoom.ts` | The app's mirror of the locator, plus the received-video and participant-cap policies. |
| `utils/streamCallState.ts` | The shell's reducer: phases, controls, status lines. |
| `utils/callWindow.ts` | Four provider-neutral window sizes, and the map from the classroom's own names. |

The two classroom screens gained three optional props on the call they already mounted
(`identity`, `isOwner`, `windowState`) and nothing else. They import no Stream type and no
Stream object.

## 4. Parity matrix

**Read the right-hand column carefully.** "Implemented" means the code path exists and is
covered by a test with a fake Stream. Nothing in this table has been seen working against
Stream's servers, because there are none to reach.

| Capability | Daily today | Stream on this branch | Evidence |
|---|---|---|---|
| Teacher joins / leaves | ✅ web + native | Implemented | fake-call test |
| **End the class for everyone** | ✅ (classroom's own End) | Implemented, `call.endCall()` | fake-call test; drawn only when `isOwner` |
| Microphone on/off | ✅ | Implemented | fake-call test |
| Camera on/off | ✅ | Implemented | fake-call test |
| Raise / lower hand | ❌ not built | Implemented, as Stream's `raised-hand` reaction | fake-call test |
| Reactions | ❌ not built | Implemented, four emoji | fake-call test |
| Participant list | ❌ not built | Implemented, from `participants$` | fake-call test |
| **Mute another participant** | ✅ (Daily owner token) | Implemented, `muteUser(id, "audio")` | fake-call test; teacher only |
| Remove a participant | ✅ (Daily owner token) | Implemented, `kickUser({block:false})` | fake-call test; teacher only |
| Screen share — web | ✅ Daily Prebuilt's own button | Implemented | teacher only; **unverified against Stream** |
| Screen share — Android/iOS | ❌ **impossible** (WebView) | Implemented in code | **blocked**: needs the native SDK, §2 |
| Student: no end-session authority | ✅ | Implemented | reducer test asserts the control is absent |
| Student: sees teacher's screen share | ✅ web only | Implemented | **unverified** |
| Device choice | ❌ | Optional; drawn only where the loader supplies it | fake-call test |
| Hidden / compact / normal / full without remount | ✅ | Implemented, and it changes what is *received* | fake-call test: five resizes, zero joins |
| Reconnect after a network drop | Daily's own | Reducer handles the states; `setDisconnectionTimeout` exists in the SDK | **unmeasured** |
| Denied camera/microphone | ✅ handled | Implemented — call keeps running, person is told | reducer test |
| Provider chat | disabled at the room | **does not exist** — Stream Chat is a separate product and is not installed | — |
| Provider picture-in-picture | disabled (`showFullscreenButton: false`) | `CallContent` takes `disablePictureInPicture`; this app does not use `CallContent` at all | — |

Sikshya's WebSocket remains the only authority for the whiteboard, presence, attendance, session
lifecycle, the unread badge and the one class chat. Nothing in this branch touches
`classroomHub.ts` or `userHub.ts`.

## 5. Research: what is verified, and what is not

`getstream.io` is blocked by this environment's network egress proxy, so **their documentation
pages could not be opened directly.** That constraint shaped what could be verified and how, and
the distinction is kept below rather than smoothed over.

### Verified by reading Stream's own published code (strongest)

Downloaded from the npm registry on **4 September 2026** and read directly. These are Stream's
own artefacts, not a description of them.

| Fact | Source |
|---|---|
| Tokens are HS256 JWTs signed with the API secret, using `jsonwebtoken` | `@stream-io/node-sdk@0.8.4` → `src/utils/create-token.ts` |
| User token claims are `user_id`, `iat`, `exp`; default validity 3600s | same, `StreamClient.generateUserToken` |
| Call token adds `call_cids: string[]` and an optional `role` | same, `StreamClient.generateCallToken` |
| A server token is `{ server: true }`, HS256, `noTimestamp` | same, `JWTServerToken` |
| REST base is `https://video.stream-io-api.com` | same, `StreamClient` constructor |
| Get-or-create is `POST /api/v2/video/call/{type}/{id}?api_key=…`, headers `Authorization` + `stream-auth-type: jwt` | same, `VideoApi.getOrCreateCall`, `ApiClient` |
| Call settings accept `video.target_resolution {width,height,bitrate}`, `video.camera_default_on`, `audio.mic_default_on`, `audio.opus_dtx_enabled`, `screensharing.access_request_enabled`, `recording.mode`, `transcription.mode` | same, `gen/models/index.ts` |
| Permissions include `end-call`, `mute-users`, `kick-user`, `screenshare`, `create-reaction`, `send-audio`, `send-video`, `block-users` | same, `OwnCapability` |
| Client call API: `join`, `leave`, `endCall`, `camera/microphone/screenShare.enable()/disable()`, `camera.flip()`, `sendReaction`, `muteUser`, `kickUser`, `setPreferredIncomingVideoResolution`, `setIncomingVideoEnabled`, `setDisconnectionTimeout`, `state.participants$` | `@stream-io/video-client@1.59.0` type definitions |
| Track type numbers: AUDIO 1, VIDEO 2, SCREEN_SHARE 3 | same, `gen/video/sfu/models` `TrackType` |
| Events `call.ended` and `call.reaction_new`; a reaction carries `type`, `emoji_code`, `user` | same, `gen/coordinator` |
| A raised hand is a reaction of type `raised-hand`, emoji `:raised-hand:` | `@stream-io/video-react-native-sdk@1.45.0` → `src/constants/index.ts` |
| Provider picture-in-picture is switchable: `CallContent` takes `disablePictureInPicture` | same, `src/components/Call/CallContent/CallContent.tsx` |
| RN SDK peers: `expo >=47`, `react-native >=0.73`, `@stream-io/react-native-webrtc ^145.3.1`, plus reanimated / gesture-handler / svg | same, `package.json` (this app is on Expo 54 / RN 0.81, so the Expo peer range is satisfied) |
| The native WebRTC fork conflict in §2 | file-list comparison of both packages |

### Verified indirectly (search-engine summaries of Stream's own pages, 4 September 2026)

Their pages could not be opened, so these come from search summaries **of** those pages. Treat
them as good but not first-hand, and confirm on the pricing page before any money decision.

- Every Stream account gets **$100/month of free Audio/Video API usage**
  (`getstream.io/video/docs/api/pricing-guide/`). Matches the August report.
- The **Maker Account** gives **333,000 video participant-minutes a month** free, alongside Chat
  and Feeds allowances (`getstream.io/maker-account/`). Application required; a 30-day trial
  starts immediately and converts on approval; hard limits, no card.
- Eligibility is roughly **fewer than 5 team members and under $10k monthly revenue**.
- Pricing is per participant-minute and varies by the resolution a participant **receives**
  (Audio Only / SD / HD / Full HD / 2K / 4K) and by call type.
- There are five call roles: `user`, `moderator`, `host`, `admin`, `call-member`
  (`getstream.io/video/docs/api/call_types/permissions/`). Grants per role are configured against
  the call type in the dashboard.

### Not verified at all

- **The exact price per 1,000 participant-minutes at each resolution.** The August report records
  $0.75/1k at 480p and $1.50/1k at 720p; that could not be re-checked today. Any cost decision
  must start by re-reading `getstream.io/video/pricing/` directly.
- Whether the `default` call type's `host` role grants `end-call`, `mute-users` and `kick-user`
  out of the box. §7 makes checking it the first credentialed step.
- Whether `created_by: { id: "sikshya-system" }` is accepted on `getOrCreate` with a server
  token, or whether that user must exist first.
- Latency and route quality from Kathmandu. Nothing in this branch says anything about it.

### What the 333,000 free minutes actually buy

At 108,000 participant-minutes per monthly-tier teacher, the Maker allowance covers **about three
teachers on the monthly tier**, or a far larger number of ordinary one-hour classes. It is a real
pilot allowance, not a business model — which is the same conclusion the August report reached by
a different route.

## 6. What is honestly untested

Stated as a list so nobody has to infer it from silence. None of the following has been
measured, observed, or run:

- Any real call. No Stream account exists; nothing in this branch has contacted Stream.
- Two devices, or one device, or a browser tab.
- Android hardware of any kind.
- Screen sharing, on any platform.
- Reconnect behaviour or reconnect timing.
- Time to first media, received bitrate, CPU, memory, battery, or thermal behaviour.
- Behaviour on a throttled or poor connection.
- Whether Stream's servers accept the call-creation body this branch sends.
- Whether the role grants on the `default` call type match what the code assumes.

What *is* measured is in the test evidence in the worklog: 315 server unit tests, 205 app unit
tests, a 24-check provider contract suite against the real server, and a 56-check sessions suite.
They prove the code does what it is supposed to do with a Stream that answers instantly and
truthfully. They prove nothing about Stream.

One other thing was measured, because it is the cost this experiment imposes on people who did
not ask for it. The web bundle was built on `bc0aa17` and on this branch: the entry bundle grew
by **15,913 bytes uncompressed and 3,494 gzipped — 0.33%**, all of it this app's own files, with
no `@stream-io` code in the export and no `STREAM_API_KEY` or `STREAM_API_SECRET` anywhere in it.
A student on a Nepali mobile connection pays about three kilobytes for the experiment. Taking the
web SDK as a dependency is what would change that number, which is why §2 does not.

## 7. Setting it up, when the owner decides to

**Do not do any of this without the owner's say-so.** It creates an account.

### Step 1 — an account and its keys

**A warning about this section, and it is the important part.** This project's rule is to hand
over the literal clicks rather than a link to a page — one vague step costs the owner hours. That
rule cannot be honoured here: `getstream.io` is blocked by this environment's network proxy, so
nobody on this branch has seen Stream's sign-up flow or dashboard. Writing out confident button
names would be inventing them, which is worse than admitting it.

So: **the URLs below are verified, the click-by-click is not.** Whoever does this first should
write down what they actually saw and replace this section with it.

1. Sign up at `https://getstream.io/`. Expect to choose a product; choose **Video & Audio**.
2. The dashboard is at `https://dashboard.getstream.io/`. An app is normally created with the
   account.
3. Somewhere on that app's page there is a **key** and a **secret**. Every Stream SDK is
   initialised with the key, and every server SDK signs with the secret, so both are always
   surfaced together.
4. The **key** is public and safe to hand to a browser. **The secret is not.** Do not paste
   either into a chat message — see `.agents/memory/rotate-daily-key-before-launch.md` for why
   that rule exists here.

### Step 2 — the free allowance

The $100/month applies automatically. For the Maker allowance, apply at
`https://getstream.io/maker-account/`; a 30-day trial starts immediately and converts on
approval. **Re-read the limits on that page before relying on them** — this document's copy is
second-hand and dated 4 September 2026.

### Step 3 — check the role grants

Somewhere in the dashboard, under the app's video settings, there is a **call types** area and a
`default` type with per-role permissions. (Same caveat as Step 1 — the exact navigation could not
be checked from here.) Confirm:

- **host** has `end-call`, `mute-users`, `kick-user`, `screenshare`, `send-audio`, `send-video`.
- **user** has `send-audio`, `send-video`, `create-reaction` — and **does not** have `end-call`,
  `mute-users` or `kick-user`.

That second line is the one to get right. The app already refuses to draw those controls for a
student, but the server-side grant is what actually stops one.

### Step 4 — point a server at it

Locally, in `.env` at the repo root (`C:\Projects\Paathshala\Paathshala\.env` on the owner's
machine):

```
VIDEO_PROVIDER=stream
STREAM_API_KEY=<the Key>
STREAM_API_SECRET=<the Secret>
```

Then, from that folder, in two terminals (on Windows use `pnpm.cmd`):

```
pnpm run dev:api
pnpm run dev:app
```

**Do not set these on Railway.** That is production, and production is on Daily.

### Step 5 — install one SDK, in a throwaway place

Web first, because it has no native conflict:

```
pnpm --filter @workspace/sikshya add @stream-io/video-react-sdk
```

Then `artifacts/sikshya/components/stream/streamSdk.web.ts` — replace the body of
`loadStreamSdk` with the import that file's comment already spells out, and write the
`ParticipantView` wrapper it names. Nothing else changes anywhere.

For a phone, §2 has to be resolved first. There are two honest routes and both are decisions,
not chores:

- **A separate experiment build.** Take Daily's native SDK out of `package.json`, put Stream's
  in, `expo prebuild`, and install that build alongside the real app under a different bundle
  identifier. It cannot run Daily, so it cannot be compared side by side with the real thing on
  one handset — but it answers the questions that matter (screen share, cheap-Android
  behaviour, Kathmandu latency).
- **Migrate.** Once the owner has decided, the conflict disappears with Daily.

## 8. Testing it, once it runs

```
pnpm run typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/sikshya run test
pnpm --filter @workspace/sikshya run lint:design
pnpm --filter @workspace/api-server run test:video       # needs a database
```

`test:video` starts the real server three times — on `echo`, on `daily`, and on `stream` with no
credentials — and checks that the class's rules are identical each time. It needs Postgres; the
worklog records how one was started for this branch.

### The two-device test to run first

Not yet possible, and the shortest path to it is: web on a laptop as the teacher, web on a phone
browser as the student. That needs only Step 5's web dependency and a Stream key.

1. Seed two accounts and a class (`pnpm run seed`), book the student in.
2. Teacher on a laptop, student on an Android phone, both at the deployed or local web app.
3. With the API on `VIDEO_PROVIDER=stream`, the teacher starts the class.
4. Watch for, in order: does anybody get in; does audio arrive before video; does the whiteboard
   still work while the call runs; does hiding the video window stop the video *and keep the
   audio*; does the teacher's screen share arrive; does the student's chat badge still buzz.
5. Then break things: turn the phone's data off for twenty seconds; deny the camera permission;
   have the teacher leave first.

Every one of those is a question this branch's tests answer with a fake and cannot answer for
real.

## 9. Turning it off

Unset `VIDEO_PROVIDER`, or set it to `daily`. An unrecognised value falls back to Daily too — a
typo in an environment variable must not take video down for the whole platform. Nothing else has
to be undone: no Stream value is compiled into the app, so the switch is server-side and
immediate for every device already installed.
