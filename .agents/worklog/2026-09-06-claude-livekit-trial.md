# LiveKit Cloud beside Daily, as a reversible trial

- Date: 2026-09-06
- Agent: claude
- Branch: codex/session-proof-integration
- Base commit: 3f24074
- Status: complete (uncommitted — the owner asked to review in preview before anything is committed)

## Requested

Replace Daily.co with LiveKit Cloud for video calling, in three steps: investigate and wait for
approval; then build; then report. The owner's constraints, in their own words:

- Do NOT commit, push, or deploy anything — review in preview first.
- Do NOT delete or modify the Daily.co code; leave it so it can be switched back instantly.
- Do NOT touch the whiteboard code; it must keep working side by side with the video.
- Ask before installing any new dependency or changing the database schema.
- LiveKit access tokens generated **server-side only**; the API secret must never reach the
  browser; read `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` / `LIVEKIT_URL` from the environment and
  add them to `.env.example`, never hardcoded.
- A single video abstraction exposing `joinRoom, leaveRoom, toggleMic, toggleCamera,
  switchCamera, startScreenShare, stopScreenShare, getParticipants, onConnectionStateChange`;
  two providers behind it; selected by `VIDEO_PROVIDER=daily|livekit` defaulting to `daily`; no
  other part of the app importing a provider directly.
- Configured for low bandwidth: 480p cap, simulcast, adaptiveStream, dynacast, and an audio-only
  mode that disables video for both sides while the whiteboard stays active.
- Handle connection drops and automatic reconnection, permission denied for camera or mic, and a
  visible connection quality indicator.

Approved on the same message: the two dependencies, and running the phone-feasibility check
(Phase 0) first. The owner has created the LiveKit Cloud project and will supply credentials when
asked — **variable names only were ever requested of them; no value was seen here.**

## Changed

New, server:

- `artifacts/api-server/src/lib/video/livekitProvider.ts` — implements the existing
  `VideoProvider` contract. Mints an 8-hour JWT with `roomJoin`, the class's room, `canPublish`,
  `canSubscribe`, `canPublishData: false`, `roomAdmin` only for the class's own teacher, and
  `canPublishSources` limited to camera + microphone for a student and camera + microphone +
  screen for a teacher. `ensureRoom` makes no network call — LiveKit creates a room when the
  first authorised participant joins.
- `artifacts/api-server/src/lib/video/roomName.ts` — provider-neutral `sikshya<id>` naming.
- `artifacts/api-server/src/lib/video/roomName.test.ts` — 4 tests, including a drift guard that
  reads `lib/daily.ts` as **source text** and fails if Daily's `sanitizeRoomName` stops agreeing.

Modified, server:

- `artifacts/api-server/src/lib/video/index.ts` — registers `livekit` in `PROVIDERS`. Default
  still `daily`.
- `artifacts/api-server/scripts/video-tests/run.mjs` — 17 new checks (see Verification).
- `artifacts/api-server/package.json` — `livekit-server-sdk@2.18.0`.

New, app:

- `artifacts/sikshya/lib/video/types.ts` — the provider-agnostic client contract.
- `artifacts/sikshya/lib/video/livekit.ts` — the LiveKit session: imperative, no React.
- `artifacts/sikshya/lib/video/index.ts` — the single door. Exports the nine verbs as free
  functions **and** returns a session handle from `joinRoom`; both are the same object.
- `artifacts/sikshya/components/LiveKitEmbed.web.tsx` — the call surface. Tiles, controls,
  reconnection banner, device-problem banner, blocked-sound button, per-person quality dot.
- `artifacts/sikshya/components/LiveKitEmbed.tsx` — the native counterpart. Renders "not
  available in the app", imports nothing from `lib/video`, so no phone bundle pulls in
  `livekit-client`.
- `artifacts/sikshya/scripts/livekit-tests/run.mjs` — 74-check browser suite.

Modified, app:

- `artifacts/sikshya/components/VideoCall.tsx` — a `livekit` case beside the `daily` one.
- `artifacts/sikshya/package.json` — `livekit-client@2.22.2` and a `test:livekit` script.

Modified, root:

- `.env.example` — `VIDEO_PROVIDER` and the three LiveKit variables, commented, with why all
  three are needed together.
- `VIDEO.md` — a "LiveKit trial" section: how to switch it on and off, why it is web only, the
  low-bandwidth settings, what has and has not been checked, and the instruction collision below.

## Decisions and assumptions

**The abstraction is implemented for LiveKit only, and `VideoCall.tsx` stays the switch.** Two of
the owner's instructions collide: "one abstraction both providers implement" and "do not modify
the Daily code". `DailyEmbed` owns its own call object and renders Daily's iframe UI; giving it
the imperative interface means restructuring exactly the code that must not move. The guarantee
actually wanted — no screen importing a provider by name — already held and still holds.
Surfaced in VIDEO.md and in the report rather than done silently.

**Web only. Phones stay on Daily.** Phase 0 counted 33 identical Android classes and 47 identical
iOS classes across the two SDKs' WebRTC forks, both declaring namespace `com.oney.WebRTCModule`
and registering the RN module as `WebRTCModule`. Neither fork can be skipped — each SDK requires
its own as a peer dependency. So one phone build cannot hold both.

**480p means 480p, including for a shared screen.** The camera cap is the SDK's own
`VideoPresets43.h480` (640×480, 500 kbps). Screen share is a custom 854×480 at 500 kbps and 5
fps — deliberately not the SDK's screen presets, whose cheapest is 360p and whose next is 720p,
which is above the cap the owner named. Frames spent on resolution rather than smoothness because
a shared screen is nearly always text.

**Audio-only keeps a shared screen.** It stops the local camera and unsubscribes from every
remote *camera*; a shared screen is content, like the whiteboard, and dropping it would leave a
student listening to somebody describe a document they cannot see. This is a judgement, not an
instruction — one line to change if the owner disagrees.

**Room naming is copied, not shared.** `roomName.ts` duplicates the rule in `lib/daily.ts`
because importing it would mean editing Daily, and because `daily.ts` reaches for a logger and
cannot be imported under `--experimental-strip-types` at all. A test guards the drift.

## Verification

Run, with output seen:

| Command | Result |
|---|---|
| `pnpm run typecheck` (all four packages) | clean |
| `api-server` `node scripts/video-tests/run.mjs` (PGURL → local test Postgres) | **34 passed, 0 failed** |
| `api-server` `node --test --experimental-strip-types "src/lib/video/*.test.ts"` | **16 passed, 0 failed** |
| `sikshya` `node scripts/livekit-tests/run.mjs` | **74 passed, 0 failed** |
| `sikshya` `node scripts/board-tests/run.mjs` | **44/44** |
| `sikshya` `node scripts/call-chat-tests/run.mjs` | **17 passed, 0 failed** |
| `sikshya` `node scripts/call-leave-tests/run.mjs` | **9 passed, 0 failed** |
| `sikshya` `node scripts/design-lint/run.mjs` | no new leaks; both new components zero hex, zero raw font sizes |
| `sikshya` `pnpm run build` | web bundle built with `livekit-client` in it; confirmed by finding the component's test ids in the output bundle |

**Actually rendered**, not merely asserted: the call surface was screenshotted in headless
Chromium at 390×844 and 1440×900 in six states — a three-person class, audio-only, reconnecting,
camera denied, sound blocked, and the teacher having left. Screenshots outside the repo, in
`/tmp/livekit-shots`. Two layout defects were found by looking at them and fixed (below).

The server suite's LiveKit half asserts, among others: the room address is `wss://`, **the API
secret appears nowhere in the response**, the API key likewise, the token is a readable JWT whose
`sub` is the account id and whose room is `sikshya<id>`, a teacher's claims carry `roomAdmin` and
`screen_share` and a student's carry neither while keeping camera and microphone, two people get
different identities, and an unconfigured LiveKit mints nothing and leaks no variable name.

A deliberate break was used to prove one new assertion is real: reverting the grid-measurement
fix turned `laptop-1440: two people are laid out the way this shape of panel wants` red and
nothing else. Restored, green again.

## Problems and surprises

1. **`Room.setAudioOnlyMode` does not exist** in `livekit-client@2.22.2`, though it is the
   obvious name and I wrote it first. It typechecked only because I had written it as an optional
   call (`?.`), which would have made audio-only silently do nothing on the receiving side — the
   half that actually saves bandwidth. Found by grepping the SDK's own definitions rather than
   trusting the name. Replaced with per-publication `setSubscribed(false)`, plus a
   `TrackPublished` listener so a student who joins *after* the mode is on does not quietly undo
   it.
2. **The grid never re-measured.** `useBoxSize` attached its `ResizeObserver` in a mount effect,
   but the grid it measures does not exist until somebody else joins — so `ref.current` was null,
   the effect never ran again, and the column count stayed at its zero-width answer of 1. Visible
   only in a screenshot: a laptop stacked two people down a 1424px-wide panel. Fixed with a
   callback ref.
3. **The self-view was wrong twice.** First a full-width block that pushed everything else off a
   phone; then, once it was an inset, it sat in the bottom-right corner directly on top of the
   name label every tile carries along its bottom edge. Moved to the top right, and given a light
   ring because an outline in the ground colour is black on black.
4. **My own test fake was too kind.** It modelled audio-only as stopping the local camera only,
   so the screenshot showed remote faces still present and a version that implemented half the
   feature would have passed. Fixed the fake to drop remote camera handles, and added assertions
   that no `<video>` element remains and that names replace the faces.
5. **`@livekit/protocol` could not be imported** for `TrackSource` — it is a transitive
   dependency and pnpm's strict layout does not expose it. `livekit-server-sdk` re-exports it, so
   no unapproved dependency was added.
6. **`docs.livekit.io` is blocked** by this environment's egress proxy, as `docs.daily.co` was.
   Everything was written against the installed SDK's TypeScript definitions and source.
7. **I ran a careless `git stash`** while probing the built bundle, which stashed the whole
   working tree and silently reverted `VideoCall.tsx`. Caught within a minute by a file-changed
   notice, recovered with `git stash pop`, and re-verified with a full typecheck. Nothing was
   lost. Recorded because it nearly wasn't noticed.
8. The local test Postgres needed its database named explicitly (`sikshya`, not the script's
   `ht` default) — the earlier green run had `DATABASE_URL` exported in the environment.

## Fabrications found

None found. No screen in this change reports a number, a total or a status derived from anything
but live state: the participant list, the mute and camera flags, and the connection quality all
come from the provider each time they are read, and the roster is rebuilt on every relevant
event rather than cached. The one place a value is remembered rather than read — the chosen
camera device id in `switchCamera` — is remembered precisely because a camera that is currently
off has no device to read back, and it is never displayed.

## Deliberately not changed

- **All Daily code.** `lib/daily.ts`, `dailyProvider.ts`, `DailyEmbed.tsx`, `DailyEmbed.web.tsx`
  are byte-for-byte unchanged. Confirmed by `git status`.
- **The whiteboard.** Nothing under the board, its socket, or `SmartBoard` was touched;
  `test:board` 44/44 says so.
- **The database.** No schema change, no migration, no `db:push`.
- **Daily webhook / session-proof ingestion.** Still off in every environment. Running on LiveKit
  leaves it equally off; LiveKit signs webhooks differently and turning that on is its own piece
  of work.
- **The default provider.** `VIDEO_PROVIDER` still defaults to `daily`, so a deployment that is
  given no new variables behaves exactly as it does today.
- **Nothing committed, pushed or deployed**, as instructed.

## Remaining risks / next pickup point

1. **No media has ever flowed.** No camera opened, no packet sent, no token presented to a
   LiveKit server. The first real test is a two-person call in preview with credentials — the
   step-by-step instructions are in the report to the owner and in VIDEO.md.
2. **A phone pointed at a `livekit` deployment gets no video** and is told so. Keep phone builds
   on a Daily deployment for the duration of the trial.
3. **Nothing seen on a real handset browser**, which is the market. Everything so far is desktop
   Chromium at a phone's dimensions, which reproduces layout and not a weak radio.
4. **Pricing is unverified.** The reason for the whole exercise is Daily's per-participant-minute
   cost against the monthly tier; nobody has yet checked what 108,000 participant-minutes costs
   on LiveKit Cloud. That belongs in `HANDOVER.md` §8 for the owner, not here.
5. **Room pre-creation is not done.** LiveKit creates rooms on join, so per-room limits (a
   maximum participant count, an empty-room timeout) are not set. The token already constrains
   who may enter; a cap would need an API call per join.
