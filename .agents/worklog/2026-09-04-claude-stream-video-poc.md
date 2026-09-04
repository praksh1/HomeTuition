# Stream Video proof of concept behind the provider seam

- Date: 2026-09-04
- Agent: claude
- Branch: `claude/stream-video-poc`
- Base commit: `bc0aa17` ("Withdraw the unsafe branch preview from this PR")
- Status: blocked — everything buildable without a Stream account is built and tested; the next
  step needs an account **and** a decision about a native dependency conflict (see below)

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
