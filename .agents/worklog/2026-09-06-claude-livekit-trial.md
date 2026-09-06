# LiveKit Cloud beside Daily, as a reversible trial

- Date: 2026-09-06
- Agent: claude
- Branch: claude/livekit-trial
- Base commit: 55d1e9f (`Record Daily embed preview deployment`, on `codex/session-create-ui`)
- Status: complete, committed and pushed at the owner's instruction

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

## Second pass — bringing this into line with Codex's work

The owner asked, before pushing, that this be brought in sync with what Codex had done in
parallel. Codex had three branches; `codex/session-create-ui` is the one that matters here,
because `8675b0f "Tokenize and harden Daily video embeds"` rewrote both Daily embeds.
`codex/staging-preview-integration` turned out to be documentation only and touches no code.

Rebased `a375e68` → `2709c59` onto `origin/codex/session-create-ui` (main `446feb7` plus nine
Codex commits). No conflicts. Codex's 244-test unit suite passes unchanged on top of it.

Four of Codex's decisions applied to `LiveKitEmbed.web.tsx`, which had independently made the
same mistakes Codex had just corrected on Daily:

- **The name band was `colors.scrim` over video.** That is not a contrast pair — it is a
  different pair on every frame, and a name over a bright whiteboard fails while the same code
  passes over a dark room. Now opaque `secondary` on `secondaryForeground`, 12.14:1, exactly the
  correction Codex made to Daily's presenter tag on review. The tile ground moved to `ink` at the
  same time, because a `secondary` band on a `secondary` tile merged into one navy rectangle the
  moment somebody turned their camera off — found by looking at the render, not by a test.
- **Leave was a filled red button.** Now destructive ink and border on `destructiveSoft`
  (6.30:1), the outline treatment Codex settled on, so the two providers do not disagree about
  what red means.
- **Controls named their state, not their action.** Now using Codex's own
  `microphoneActionLabel` / `cameraActionLabel` / `screenShareActionLabel` from
  `utils/dailyEmbedUi.ts` — pure and provider-independent by Codex's design — so a screen reader
  hears identical wording on both providers. `watchedParticipantLeft` likewise.
- **`onLeft` could fire twice.** Pressing Leave disconnects, and disconnecting is itself a
  departure, so the classroom's teardown-and-navigate ran twice. Codex found this on Daily; it
  was here too. Guarded by `leftAnnounced`, and pinned by a new browser assertion.

`components/VideoCall.tsx` tokenized while I was in it — the last file in the video path still
writing its own colours. Baseline **113 → 111 hex, 339 → 338 sizes**.

### A regression found in Codex's change, and fixed

**Codex's Windows fix for the browser suites breaks them on Linux, which is where CI runs.**
`node_modules/esbuild/bin/esbuild` is a JavaScript launcher on Windows and *the native binary
itself* on Linux, so `node <that path>` reads `ELF` as a syntax error. Both `test:call-leave` and
`test:call-chat` failed to bundle at all on this machine; they passed before the rebase.

There is no CLI path that is right on both platforms. New `scripts/bundle-for-browser.mjs` uses
esbuild's JavaScript API instead, which is the same module everywhere and locates its own binary;
all three video suites now share it. It resolves esbuild through `createRequire` from
`api-server/package.json` rather than by guessing a path into pnpm's store, and passes
`nodePaths` so a harness can keep its scratch entry file out of the repository and still resolve
React.

This was found by running Codex's suites after rebasing rather than assuming they still passed.

### Verification after the second pass

| Command | Result |
|---|---|
| `pnpm run typecheck` (four packages) | clean |
| `sikshya` `pnpm run test` | **244 passed, 0 failed** (includes Codex's new contract tests) |
| `api-server` `scripts/video-tests` | **34 passed, 0 failed** |
| `api-server` `src/lib/video/*.test.ts` | **16 passed, 0 failed** |
| `sikshya` `scripts/livekit-tests` | **82 passed, 0 failed** (was 74; +8 for the new properties) |
| `sikshya` `scripts/call-leave-tests` | **9 passed, 0 failed** — restored on Linux |
| `sikshya` `scripts/call-chat-tests` | **17 passed, 0 failed** — restored on Linux |
| `sikshya` `scripts/board-tests` | **44/44** |
| `sikshya` `lint:design` | 111 hex / 338 sizes, baseline lowered and locked |

Re-rendered at both widths after each visual change and looked at the result.

## Third pass — making the trial switchable, and a security review

The owner said to carry on while they were away from the machine, with the credentials to follow.
Everything here is work that did not need them.

### The trial could not actually be switched on

The blocker was one I had documented as a warning rather than solved: with a single deployment,
setting `VIDEO_PROVIDER=livekit` served LiveKit rooms to *every* client, and neither phone build
contains LiveKit — so trying the trial in a browser took video away from every phone on the
platform. "Don't point phones at it" is not advice that can be followed when there is one
deployment.

Now the server decides per client. `VideoProvider` gained a `platforms` field (a fact about the
build, not a preference), the app sends `X-Sikshya-Platform` on every request, and the room route
gives a browser whatever is configured while a phone gets Daily. Three rules, each of which was a
way to get it wrong:

- **Silence means Daily.** An app build older than the header is more often a phone than a
  browser, and a phone handed a `wss://` address shows a black rectangle. A guess at "web" would
  break exactly the clients the rule exists to protect.
- **The header confers nothing.** The worst a lie wins is the provider that could have been asked
  for honestly. Asserted: a student claiming to be a browser still gets a student's token.
- **Session-start pre-creation asks for the teacher's platform too**, so a teacher starting from
  a phone pre-creates the Daily room they are about to join rather than a LiveKit one they
  cannot. An optimisation either way — the room route creates on demand — but pre-creating the
  wrong provider's room is pre-creating nothing.

`utils/api.ts` had five copies of the same two header lines and was about to get a sixth; they
are now one `baseHeaders()`, so a header added there reaches every request rather than the four
somebody remembered.

### A preflight the owner can run alone

`artifacts/api-server/scripts/livekit-check.mjs`, wired up as `livekit:check`. It answers the one
question the app cannot: *is it my key, or is it my wi-fi?* — because a wrong secret and a bad
connection produce the same message inside a lesson. It checks the three variables are present
and well-formed, that the secret can sign a token, and that LiveKit itself accepts them, naming
the next action after every failure.

The secret is never printed, not even partially. This is a diagnostic — it gets run when
something is wrong, which is when people take screenshots.

### Security review

Nothing found on the paths that matter. `LIVEKIT_API_SECRET` appears in no client file and no
`EXPO_PUBLIC_` variable; exactly one route mints tokens, and only after `lib/membership.ts` has
admitted the caller and the session window has been checked; moderator rights and screen sharing
derive from `isSessionTeacher` and are asserted in the token's decoded claims rather than in the
UI.

**One finding, deliberately not fixed: a join token outlives its class.** Eight hours, so somebody
who joined at 10:00 still holds a usable credential at 17:00 — after the class, after a refund,
after being unenrolled. Not a regression (Daily's token behaves identically), but LiveKit makes a
better answer available: set the token's `ttl` to the class's own overtime cutoff, which
`lib/sessionStart.ts` already computes.

Not done because it cannot be tested here. Whether LiveKit disconnects a participant when their
token expires mid-call, or only checks at join and reconnect, is not answerable from the SDK's
types, and `docs.livekit.io` is blocked. Guessing wrong drops students mid-lesson, which is much
worse than the exposure it closes. One experiment against a real server settles it; then it is
two lines. Written up in VIDEO.md.

### Verification after the third pass

| Command | Result |
|---|---|
| `pnpm run typecheck` (four packages) | clean |
| `api-server` `scripts/video-tests` | **42 passed, 0 failed** (was 34; +8 for per-client selection) |
| `api-server` `src/lib/video/*.test.ts` | **22 passed, 0 failed** (was 16) |
| `sikshya` `pnpm run test` | **244 passed, 0 failed** |
| `sikshya` `scripts/livekit-tests` | **82 passed, 0 failed** |
| `sikshya` `call-leave` / `call-chat` / `board` | **9 / 17 / 44** |
| `sikshya` `lint:design` | no new leaks |
| `livekit:check`, every failure branch | run by hand: missing values, a truncated secret, an `https://` URL, and a blocked network each produce the right sentence and the right remedy |

Two defects in my own preflight were found by running it rather than reading it: it carried on to
ask LiveKit about settings already known to be wrong (two errors, unclear which caused which),
and it reported a proxy block as a credentials problem — which would have sent somebody to
regenerate a key that was fine. Both fixed.

## Remaining risks / next pickup point

1. **No media has ever flowed.** No camera opened, no packet sent, no token presented to a
   LiveKit server. The first real test is a two-person call in preview with credentials — the
   step-by-step instructions are in the report to the owner and in VIDEO.md.
2. **`livekit:check` has never reached a real LiveKit project.** Its settings and token-signing
   checks were run, including every failure branch; the two branches needing livekit.cloud —
   "accepted" and "refused" — could not be. It is the first thing to run with real credentials.
3. **Nothing seen on a real handset browser**, which is the market. Everything so far is desktop
   Chromium at a phone's dimensions, which reproduces layout and not a weak radio.
4. **Pricing is unverified.** The reason for the whole exercise is Daily's per-participant-minute
   cost against the monthly tier; nobody has yet checked what 108,000 participant-minutes costs
   on LiveKit Cloud. That belongs in `HANDOVER.md` §8 for the owner, not here.
5. **`utils/dailyEmbedUi.ts` is now imported by a LiveKit component**, which makes its name
   wrong. Worth renaming to `videoEmbedUi.ts` once `codex/session-create-ui` has landed —
   doing it here would have collided with work still in flight.
6. **Codex's two other branches are still unmerged.** `codex/session-create-ui` is the base of
   this commit; `codex/staging-preview-integration` is documentation only and does not conflict.
   Neither is on `main`.
7. **Room pre-creation is not done.** LiveKit creates rooms on join, so per-room limits (a
   maximum participant count, an empty-room timeout) are not set. The token already constrains
   who may enter; a cap would need an API call per join.
