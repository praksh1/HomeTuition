# Stream Video proof of concept behind the provider seam

- Date: 2026-09-04
- Agent: claude
- Branch: `claude/stream-video-poc`
- Base commit: `bc0aa17` ("Withdraw the unsafe branch preview from this PR")
- Status: blocked — everything buildable without a Stream account is built and tested; the next
  step needs an account **and** a decision about a native dependency conflict (see below)
- Updated 2026-09-04 with a correction pass answering Codex's review — §"Correction pass" at the
  end. Nothing above it has been rewritten; the defects it found are recorded there as found.

## Requested

Item 7 of `.agents/backlog/2026-09-02-owner-corrections-and-stream-poc.md`: build an isolated
Stream Video proof of concept behind the existing provider seam, keeping Daily as the production
default; register Stream only behind `VIDEO_PROVIDER=stream`; fail closed with a truthful
configuration error when there are no credentials; keep the server-decided `isOwner`, membership
checks, classroom time gates, short-lived server-minted tokens and redacted logs; keep Sikshya's
own draggable hidden/compact/normal/full window and its WebSocket authoritative; verify Stream's
current documentation, SDK compatibility, free limits and pricing from official sources with
retrieval dates; add deterministic tests with fakes and never call live Stream from CI; prove the
Daily and echo contract tests unchanged; stop exactly at the credential boundary; and record all
of it.

## Changed

### New — server (`artifacts/api-server/src/lib/video/`)

- `streamCall.ts` — pure, zero runtime imports so it is unit-testable under
  `--experimental-strip-types`. Room-locator format, call id derivation, JWT claim construction,
  bandwidth-conservative call settings, configuration-error text, key redaction.
- `streamProvider.ts` — the `VideoProvider`. `configured()`, `ensureRoom()` (Stream's
  `POST /api/v2/video/call/{type}/{id}` get-or-create), `joinToken()` (HS256, `jsonwebtoken`,
  already a dependency), `identityFor()`.
- `streamCall.test.ts` — 18 tests.
- `streamProvider.test.ts` — 17 tests, `globalThis.fetch` stubbed so nothing can reach Stream.

### Modified — server

- `lib/video/index.ts` — registers `stream`. `daily` remains the fallback for unset/unknown names.
- `lib/video/types.ts` — `JoinOptions.userId` (required), `VideoProvider.identityFor?()`
  (optional), `RoomGrant.identity`.
- `lib/video/video.test.ts` — the four local fixture calls gained `userId`. Every assertion is
  unchanged.
- `routes/sessions.ts` — passes `userId` to `joinToken`; returns `identity` in the room grant.
  Membership check, time gates, `isOwner` derivation and error handling untouched.
- `scripts/video-tests/run.mjs` — one new check on the echo run (`identity` is null for a
  provider without identities) and a seven-check Stream section on a third server instance.

### New — app (`artifacts/sikshya/`)

- `utils/callWindow.ts` — the four provider-neutral window states and the map from the
  classroom's own `hidden|small|medium|full`.
- `utils/streamRoom.ts` — mirror of the server's locator parser, plus `incomingVideoFor()` and
  `visibleParticipants()` / `VISIBLE_PARTICIPANT_CAP`.
- `utils/streamCallState.ts` — the shell's reducer, `callControls()`, `callStatusLine()`.
- `components/StreamCall.tsx` — Sikshya's window with Stream's media inside it. One file for both
  platforms; the platform split is one import lower.
- `components/stream/streamBridge.ts` — the Sikshya/Stream boundary types.
- `components/stream/streamSession.ts` — maps a Stream `Call` onto this app's session, and
  `createStreamSdkFrom()` which builds a client from whichever module a platform loaded.
- `components/stream/streamSdk.ts`, `streamSdk.web.ts` — the two loaders. Both currently return
  `{ ok: false, reason }`.
- `utils/streamRoom.test.ts` (10), `utils/streamCallState.test.ts` (18),
  `components/stream/streamSession.test.ts` (23).

### Modified — app

- `components/VideoCall.tsx` — a `stream` branch and three optional props (`identity`, `isOwner`,
  `windowState`). The `daily` branch is unchanged and receives none of them.
- `app/(teacher)/classroom/[id].tsx`, `app/(student)/classroom/[id].tsx` — read `identity` from
  the room grant, hold it in state, and pass `identity` / `windowState` (and `isOwner` on the
  teacher's screen) to `VideoCall`. Neither screen imports a Stream type or object.

### Modified — root

- `.env.example` — `VIDEO_PROVIDER`, `STREAM_API_KEY`, `STREAM_API_SECRET`, `STREAM_CALL_TYPE`.
- `STREAM.md` — new. Setup guide, parity matrix, research with retrieval dates and a verified /
  indirect / unverified split, the list of what is untested, and the two-device test to run first.

## Decisions and assumptions

**The contract grew by two things, not five.** `JoinOptions.userId` and
`identityFor()`/`RoomGrant.identity` are genuinely cross-provider — LiveKit, Jitsi and 100ms all
bind a token to an identity. `VideoCapabilities` was deliberately *not* extended with
`reactions` / `raiseHand` / `moderation` flags: the classroom screens draw no call controls, the
provider's own shell does, and it already knows which provider it is. A flag there would be a
fact the code already has. `userId` was made required rather than optional so no provider can
silently mint a token bound to `undefined`; the cost was four fixture lines in `video.test.ts`.

**`ensureRoom` returns a locator, not a URL.** Stream has no per-call address. The string is
`stream:call/<type>/<id>?api_key=<key>` and deliberately does not look openable. The API key
rides in it because it is Stream's publishable half — which means **no Stream value is compiled
into the Expo bundle**, so switching the provider off at the server switches it off on every
installed phone with no rebuild.

**The join token is scoped to one call and lives one hour.** `call_cids: ["<type>:<id>"]` is the
important half: without it a Stream token opens every call in the app, which would hand a student
who booked one class a credential for every other lesson on the platform. One hour is Stream's
own default, and deliberately not the eight hours the Daily path uses.

**`role: host` is a request, not a grant.** What `host` may do is configured against the call
type in Stream's dashboard. So the app is told `isOwner` separately and gates its teacher-only
controls on that as well — a misconfigured dashboard cannot put an End button in front of a
student, and a tampered client cannot make Stream honour one.

**The call is created by the platform, not the teacher.** `created_by: { id: "sikshya-system" }`.
Naming the teacher would give one participant a standing that did not come from this server's
membership check.

**A hidden window receives no video at all.** The requirement to not subscribe to hidden tracks
is implemented as `setIncomingVideoEnabled(false)`, and the visible sizes ask for 180p / 360p /
480p. This is the same lever for money (Stream bills by received resolution) and for battery. It
needed one provider-neutral prop on `VideoCall` and one line in each classroom, because the
classroom hides the window with `display: none`, which no `onLayout` reports.

**The SDK is not installed, and that is the branch's boundary.** See "Problems and surprises".

## Verification

Postgres 16 was not running in this container; a cluster was initialised at
`/var/lib/postgresql/htdata` on port 55432, `ht` created, `pnpm run db:push` applied, and the API
built and run on 8080 for the suites that need one. Commands and exact counts:

| Command | Result |
|---|---|
| `pnpm run typecheck` | **pass**, all four packages (baseline: pass) |
| `pnpm --filter @workspace/api-server run test` | **315 pass, 0 fail** (baseline 280 — +35 new) |
| `pnpm --filter @workspace/sikshya run test` | **205 pass, 0 fail** (baseline 154 — +51 new) |
| `pnpm --filter @workspace/sikshya run lint:design` | **no new leaks**; 223 hex / 429 sizes across 57 files, identical to baseline |
| `pnpm --filter @workspace/api-server run test:video` | **24 passed, 0 failed** (16 before) |
| `pnpm --filter @workspace/api-server run test:sessions` | **56 passed, 0 failed** |

Baselines were captured on `bc0aa17` before any edit: typecheck pass, 280 / 154 unit tests, and
`lint:design` at 223 hex / 429 sizes across 57 files. `lint:design:update` was **not** run and
the baseline file is untouched — the new files contribute zero violations.

**The web bundle was built on both commits and compared**, because a typecheck cannot prove Metro
resolves a platform-split file and cannot prove what reaches a student's phone:

| | `bc0aa17` | this branch |
|---|---|---|
| `expo export -p web` | succeeds | succeeds |
| entry bundle | 4,770,466 bytes | 4,786,379 bytes (**+15,913, +0.33%**) |
| entry bundle, gzipped | 1,252,742 bytes | 1,256,236 bytes (**+3,494, +0.28%**) |

Grepping the produced bundle:

- the **web** loader's wording is present and the **native** loader's wording is absent, so
  Metro really did resolve `streamSdk.web.ts` over `streamSdk.ts`;
- `stream:call/` is present, so the shell is wired in;
- **no `@stream-io/video*` code is in the bundle** — the +16 KB is entirely this app's own files;
- **no `STREAM_API_KEY` or `STREAM_API_SECRET` appears anywhere in the export**, which is the
  "no secret in a public bundle" requirement checked rather than asserted.

**Daily and echo unchanged.** `test:video` starts the real server on `echo` and on `daily` and
checks the same sixteen things it checked before; all sixteen still pass, with the same
assertions. The seventeenth is new and is about `identity` being null for a provider that has no
identities.

**The Stream section of `test:video` proves the fail-closed order**, which is the part worth
having: with `VIDEO_PROVIDER=stream` and no credentials, the teacher and the paid student both
get 502 with no `roomUrl` and no `token`, but somebody who never booked gets **403** and somebody
signed out gets **401** — the membership check runs before the provider is consulted. A class
three days over still gets 409. If those ever swapped over, an unconfigured provider would look
like an access control and a configured one would quietly stop being one.

**No test contacts Stream.** `streamProvider.test.ts` stubs `globalThis.fetch` and includes a
test asserting zero fetch calls when unconfigured; the app-side tests drive a fake call object.

### Measured versus inferred

Measured here: the test counts above; the native WebRTC fork conflict (file lists compared
directly); every Stream API shape used (read out of Stream's own published packages — see
STREAM.md §5 for the file-by-file table).

**Not measured, and not claimed anywhere:** any real call, two devices, one device, Android
hardware, screen sharing, reconnect behaviour or timing, time to first media, received bitrate,
CPU, memory, battery, thermal behaviour, or behaviour on a throttled connection. There is no
Stream account and nothing on this branch has contacted Stream.

## Problems and surprises

**1. The blocking discovery: Daily's and Stream's WebRTC forks cannot coexist natively.**
`@stream-io/video-react-native-sdk@1.45.0` peer-depends on `@stream-io/react-native-webrtc@^145.3.1`;
this app has `@daily-co/react-native-webrtc@124.0.6-daily.2`. Comparing the two packages: **33
Java classes with identical fully-qualified names**, **45 identically-named iOS/macOS sources**,
both registering a React Native module called `WebRTCModule`, and two different prebuilt WebRTC
binaries (`org.jitsi:webrtc:124.+` vs `io.getstream:stream-video-webrtc-android:145.9.0`). This
is a build failure, not a subtle bug — which at least means it cannot ship by accident. It moves
the branch's stopping point earlier than the packet assumed: not "we lack credentials" but "the
native SDK cannot be installed while Daily is". STREAM.md §2 and §7 set out the two honest routes.

**2. `jsonwebtoken` deletes `iat` when `noTimestamp: true`.** The first token implementation
signed with `noTimestamp: true` and produced a token with an `exp` and no issue time. Caught by
`streamProvider.test.ts` ("a token expires within the hour", `NaN !== 3600`) rather than in
production. Stream's own `@stream-io/node-sdk` does the same dance for the same reason; the fix
and the reason are now in a comment at the call site.

**3. `getstream.io` is blocked by this environment's egress proxy** (`CONNECT tunnel failed,
403`), so their documentation could not be opened directly. Worked around by reading Stream's own
published npm packages, which is a *stronger* source for API shapes than prose — every signature,
claim name, permission string, event name and track-type number in this branch was read out of
`@stream-io/node-sdk@0.8.4`, `@stream-io/video-client@1.59.0` or
`@stream-io/video-react-native-sdk@1.45.0`. It is a *weaker* source for pricing and free-tier
limits, which exist only on web pages. STREAM.md §5 splits the two and names what remains
unverified — chiefly the exact price per 1,000 participant-minutes at each resolution.

**4. This also means the click-by-click sign-up route could not be written.** This project's rule
is to hand over literal clicks rather than a link. That could not be honoured for Stream's
dashboard without inventing button names, so STREAM.md says so explicitly and asks whoever does
it first to write down what they actually saw.

**5. Node cannot resolve extensionless relative imports under `--experimental-strip-types`**
(confirmed empirically, not assumed). That constrained the file layout: the testable web
integration was moved out of `streamSdk.web.ts` — which Metro bundles, and where an explicit
`.ts` extension would have been an untested resolver risk — into `streamSession.ts`, which has no
runtime imports at all. It turned out to be better architecture anyway: both of Stream's SDKs
re-export `StreamVideoClient` from `@stream-io/video-client`, so the client construction is
genuinely shared rather than web-specific.

**6. `assert.equal` narrows its first argument in current `@types/node`**, so
`assert.equal(x, undefined)` followed by `x?.length` typechecks as `never`. One test rewritten.

**7. Feather has no `hand` icon.** The raise-hand control uses `chevrons-up`.

## Fabrications found

**None found.** The area touched has no invented numbers: the room route reads real membership
and real session timing, and the new provider refuses rather than returning a plausible room.

The one thing worth naming under this heading is a fabrication that was **avoided**: with no SDK
installed, the obvious shortcut was a call shell that renders fake tiles and controls that appear
to work. It would have demoed well and taught the owner nothing true. Instead the classroom says
what is missing, in words, with a way out of the call — the same rule payments and email already
follow here. No row added to `.agents/backlog/ui-upgrade-progress.md`.

## Deliberately not changed

- **Daily.** `dailyProvider.ts`, `lib/daily.ts`, `dailyRoom.ts`, `DailyEmbed.tsx`,
  `DailyEmbed.web.tsx` — untouched. `VIDEO_PROVIDER` still defaults to `daily` and still falls
  back to it for an unknown name.
- **The classroom WebSocket.** `ws/classroomHub.ts` and `ws/userHub.ts` — untouched. The
  whiteboard, presence, attendance, session lifecycle, the unread badge and the one class chat
  are all still Sikshya's.
- **No Stream chat and no provider PiP.** Stream Video ships no chat at all (Stream Chat is a
  separate product and is not installed), and this app does not use Stream's `CallContent`, which
  is the component that would bring PiP.
- **No dependency added.** Neither Stream SDK is installed, for the reasons above. `pnpm-lock.yaml`
  is untouched.
- **No account, no keys, no billing, no deploy, no DNS.** Nothing was created anywhere external.
- **No PR opened.** Not asked for.
- `lint:design:update` not run; `scripts/design-lint/baseline.json` untouched.
- Items 1–6 of the correction packet — a different branch's work.

## Remaining risks / next pickup point

**The credential boundary, in order:**

1. Owner decides whether to create a Stream account (free; §7 of STREAM.md). Nothing here has
   done so.
2. With a key and secret, confirm the two things this branch had to assume: that
   `created_by: { id: "sikshya-system" }` is accepted on `getOrCreate` with a server token, and
   that the `default` call type's `host` role grants `end-call` / `mute-users` / `kick-user`
   while `user` does not.
3. Re-read `getstream.io/video/pricing/` directly and recompute the monthly-tier cost from the
   480p figure. The August report's $0.75/1k could not be re-verified today.
4. Install `@stream-io/video-react-sdk` and finish the fifteen-line body of `loadStreamSdk` in
   `streamSdk.web.ts` — web is the only platform with no blocker.
5. Run the two-device web test in STREAM.md §8 before anything native.

**The native decision is the real risk, and it is the owner's.** Screen sharing from a phone is
the single capability Stream would add that Daily cannot do at all here, and it is the one thing
that cannot be tested without either a throwaway build that removes Daily or a commitment to
migrate. Everything else can be answered from a browser.

**Smaller risks.** The Maker allowance (333,000 participant-minutes/month) is second-hand and
dated; it covers roughly three monthly-tier teachers, so it is a pilot allowance and not a
business model. Nothing is known about Kathmandu latency to Stream's edge. And `identity` is now
in the room grant but only Stream uses it — if a third provider arrives and does not, the
`null` case is already the tested default.


---

# Correction pass — Codex review, 2026-09-04

- Base for this pass: `30c59f5`
- Scope: the eight correctness gaps Codex raised. No new research, no account, no dependency, no
  deploy, no PR, and Daily untouched.

## Defects found, and what each correction actually was

### 1. Moderation was being handed the wrong identifier — the worst of the eight

`toCallParticipant()` put Stream's **session** id into a single `CallParticipant.id`, and the
shell passed that same field to `muteUser()` and `kickUser({ user_id })`. Both take the
**persistent user** id. Stream would have matched nobody and returned no error: a teacher presses
Mute, sees no complaint, and watches the student keep talking. Rendering, meanwhile, genuinely
needs the session id — a video track belongs to a connection, and somebody signed in on a laptop
and a phone at once has two of those and one user id.

**Correction.** `CallParticipant` now carries `userId` and `sessionId` as separate fields and no
`id` at all, so there is nothing left to pass to the wrong place. Moderation takes `userId`;
`VideoView` takes `sessionId` (the prop was renamed from `participantId` to say so); tiles are
keyed by `sessionId`. The bridge's `muteParticipant`/`removeParticipant` parameters are named
`userId`. Every fixture in the tests now uses deliberately unlike values (`user-9` vs
`sess-ZZZ`), and the new test asserts both that the right string arrives **and** that the session
id appears nowhere in what was sent — the old fixtures used `"s"` and `"1"`, which would have
passed either way.

### 2. Reconnection and permission handling were scaffolding

`onReconnecting`, `onRejoined` and `onPermissionDenied` existed on the bridge and in the reducer,
and **the adapter never emitted any of them.** A call that dropped would have sat there looking
connected. Worse, `permission-denied` was one flag for both devices and switched *both* off: a
student who allowed the microphone and refused the camera — the sensible thing on a shared family
phone — had their working microphone taken away and was told both were blocked.

**Correction, from Stream's own published types rather than invented.**
`call.state.callingState$` is a real `Observable<CallingState>` (`store/CallingState.d.ts`), and
each device manager's state carries a real `hasBrowserPermission$`
(`devices/DeviceManagerState.d.ts`) — one per manager, so camera and microphone are genuinely
separate. The adapter now subscribes to all three:

- `reconnecting` and `migrating` → `onReconnecting` (a migration looks identical from a student's
  chair); `joined` → `onRejoined`, but only if something was actually reconnecting, so the first
  join does not race the connect path's own `onJoined`; `reconnecting-failed` and `offline` →
  `onError` with a sentence, rather than spinning on "trying to get back in…" forever; `left` →
  `onLeft`.
- Each device's permission → `onPermissionDenied(device, …)` / `onPermissionGranted(device)`.
  `state` is optional on the shape, so a manager version that does not expose the observable
  means the shell simply never claims a device was refused — the honest failure direction.

Reducer: `permissionDenied` became `cameraDenied` + `micDenied`, only the refused device is
switched off, `callControls` gates each button on its own device, and the status line names the
device that was actually blocked.

The `CallingState` strings are copied rather than imported (the SDK is not installed) and
**pinned by a test**, so a drift is a failing test rather than a call that silently stops
reporting that it dropped.

### 3. Received reactions were collected and never drawn

`state.reactions` was written on every incoming reaction and rendered nowhere, which made
"reactions" a capability the app claimed and did not have.

**Correction.** A chip row above the control bar: emoji plus the sender's name, `pointerEvents:
"none"` so it can never take a tap meant for a button behind it, `flexWrap` so it survives phone
width, tokenised colours and type only (`lint:design` unchanged). Bounded and deterministic
without a timer or an animation: at most three, **one per person** — somebody's newer reaction
replaces their own older one, so one student tapping twenty times occupies one place. They stay
until replaced rather than fading, which on a budget Android is the point.

The adapter also now passes the sender's `userId` and `name` (previously a synthetic
`` `${from}-${Date.now()}` `` id, which could not be attributed to anybody).

### 4. The shell had a second, weaker way to end a class

"End the class for everyone" called Stream's `endCall()` and nothing else — so the video would
stop while Sikshya went on believing the lesson was running: no `status: completed`, no cancelled
reminder, no closed attendance record, and none of the confirmation the teacher's own End Session
button asks for.

**Correction: removed, at four levels**, so it cannot come back by accident.

- The control is gone from `StreamCall.tsx`.
- `endForEveryone` is gone from `CallControls` — the test asserts the key is *absent* rather than
  false, so re-adding it cannot quietly satisfy the test.
- `endForEveryone` is gone from `StreamBridgeSession`.
- `endCall` is not even declared on `StreamCallLike`, so a later edit cannot reach for it.

Verified against the teacher HUD: `endSession()` in `app/(teacher)/classroom/[id].tsx` clears
`roomUrl`, which unmounts the call component, whose cleanup leaves the call. The provider's media
stops as part of the application's lifecycle. Students never had this control and still do not.

### 5. Two false messages, one in the app and one in the documentation

Both loaders ended "The class is running on Daily; nothing here is broken." That is false —
this code only runs when the **server has selected Stream** — and it told somebody staring at a
dead video window that everything was fine.

And the documentation claimed the person is told which configuration is missing. They were not:
the route returned a flat `Failed to set up video room`.

**Correction.** The loaders now say the class is set up to use Stream, the Stream client is not
part of this build, the call cannot open, and nothing the person does will fix it. On the server,
`VideoNotConfiguredError` (a typed error carrying a `detail`) separates "never set up" from "bad
minute": the route logs the detail — which names the variables — and answers **503** with
*"Video calling is not set up on this server yet, so this class cannot open its call."* A
provider failure keeps its 502. The contract suite asserts both the sentence and that
`STREAM_API_KEY`/`STREAM_API_SECRET` appear nowhere in the response.

Also removed: the claim that the room route and the classroom screens were untouched. They were
not, and STREAM.md now says exactly what changed in each.

### 6. A one-hour token against a ninety-minute class

The client received a static one-hour token. Stream's client reconnects with the token it already
holds, so a ninety-minute lesson would have dropped somebody at the hour mark and refused the
rejoin — worst on exactly the connections this product is built for.

**Correction: a bounded TTL derived from the class**, not a refresh endpoint.
`streamTokenTtlSeconds(duration)` = `DOORS_OPEN_MINUTES + duration + OVERTIME_CUTOFF_MINUTES`,
with those two imported from `sessionStart.ts` rather than copied, so the token cannot drift from
the clock the rest of the class runs on. That span is the widest gap between the earliest moment a
token can be minted and the last moment `canStart` will still open the door.

Clamped to **1–6 hours**, because `duration` is validated as "a positive integer" and nothing
more (checked: `routes/sessions.ts` has no upper bound) — a typo of 100000 must not mint a
credential that lives ten weeks. It needed one new `JoinOptions` field, `durationMinutes`, which
the route already had in hand. Still scoped to exactly one call via `call_cids`.

**The refresh path was considered and rejected for this pass, not overlooked.** Stream's
`tokenProvider` option is real in `@stream-io/video-client@1.59.0`'s types; wiring it needs a
route of its own repeating the membership and timing checks, which is more surface than a proof
of concept should add. Nothing on this branch claims refresh support. The trade-off — a
longer-lived token is worth more if stolen — is written into the code comment and STREAM.md.

### 7. Both parsers could throw where they promised null

`decodeURIComponent` throws on a malformed percent escape (`%zz`, or a bare `%`). Both parsers
documented that anything unreadable returns null and then threw instead — on the client, out of a
`useMemo` during render.

**Correction.** All decoding moved inside one `try` on both sides, returning null. Four new
malformed cases in each test file (`%zz`, trailing `%`, a truncated multi-byte sequence in the
path, a bare `%` as the call id).

### 8. Documentation reconciled

The parity matrix now uses a four-rung evidence ladder — **source-verified**, **adapter-tested**,
**reducer-tested**, **not implemented** — instead of a flat "Implemented", because the review was
right that reducer-only coverage was being presented as though it proved integration. Reconnect
and permission rows moved up to source-verified + adapter-tested; the end-session row became
"deliberately absent"; reactions split into sending and receiving. Real media, Stream's acceptance
of anything, device behaviour, pricing and Kathmandu network quality all stay explicitly
unverified, and two new "untested" entries were added for reconnect timing and real permission
prompts. The Daily/Stream WebRTC collision finding, Daily as default, no Stream dependency and no
external account are all unchanged.

## Failed attempts and surprises in this pass

**`readonly detail: string` as a constructor parameter property broke the whole test file.**
Node's `--experimental-strip-types` refuses TypeScript parameter properties outright
(`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), so `streamProvider.test.ts` failed to load entirely rather
than failing one test. Fixed by declaring the field and assigning it in the body. Same family of
constraint as the extensionless-import one `select.ts` already documents.

**A test I had written was itself asserting the defect.** `"a teacher on a provider that cannot
share a screen is not offered one"` ended with `assert.equal(controls.endForEveryone, true)` —
so removing the wrong control turned a passing test red for the right reason. Rewritten to assert
`moderate` instead, which is what that test was actually about.

**The first `.web.ts` edit went to the wrong layer.** The truthful-message change initially
touched a copy of the connect logic that had already been moved into `streamSession.ts` during
the first pass; the loader file was left holding only the message. Caught by grep rather than by a
test, since both compiled.

## Verification (this pass)

Narrow first, as asked:

| Command | Result |
|---|---|
| `node --test` on the two server Stream files | **39 pass, 0 fail** (21 + 18) |
| `node --test` on the three app Stream files | **71 pass, 0 fail** (10 + 24 + 37) |
| `pnpm run typecheck` | **pass, all four packages** |
| `pnpm --filter @workspace/api-server run test` | **319 pass, 0 fail** (was 315) |
| `pnpm --filter @workspace/sikshya run test` | **225 pass, 0 fail** (was 205) |
| `pnpm --filter @workspace/api-server run test:video` | **26 passed, 0 failed** (was 24) |
| `pnpm --filter @workspace/sikshya run lint:design` | **no new leaks**; 223 hex / 429 sizes across 57 files, unchanged |
| `git diff --check` | clean |

`lint:design:update` was **not** run; the baseline file is untouched and the counts did not move.

**Bundle comparison re-run**, because the shell changed:

| | entry bundle | gzipped |
|---|---|---|
| `bc0aa17` (baseline) | 4,770,466 | 1,252,742 |
| `30c59f5` (first pass) | 4,786,379 | 1,256,236 |
| this pass | **4,787,300** (+16,834 / +0.35% vs baseline) | **1,256,354** (+3,612) |

The reaction overlay and the extra observables cost 921 bytes over the previous pass. Grepping
the new export: `stream-io/video` 0 files, `STREAM_API_KEY` 0, `STREAM_API_SECRET` 0, `running on
Daily` 0, `endForEveryone` 0 — and `stream:call/` and the new truthful loader message each in 1,
so the platform split still resolves to the web loader.

## What remains unverified after this pass

Unchanged and still true: no Stream account, no real call, no second device, no Android hardware,
no screen share, no measured reconnect timing, no bitrate/CPU/memory/battery, nothing about
Kathmandu latency, no confirmation that Stream accepts the call-creation body or that the
`default` call type's role grants match what the code assumes.

Two things this pass specifically did **not** make real:

- **Reconnection is wired, not exercised.** `callingState$` is Stream's own observable and the
  adapter is driven through it in tests, but no connection has ever dropped here.
- **Permission handling is wired, not exercised.** `hasBrowserPermission$` is Stream's own
  observable; nobody has denied a camera on a phone.

Both are now described that way in the parity matrix rather than as "Implemented".

## Next pickup point

Unchanged from the first pass, and §7 of STREAM.md is still the route: an account, then confirm
the call-creation body and the role grants, then re-read the pricing page, then install the web
SDK and finish `loadStreamSdk`, then the two-device web test. The native decision — a throwaway
build with Daily removed, for screen sharing from a phone — is still the owner's and still the
only question a browser cannot answer.
