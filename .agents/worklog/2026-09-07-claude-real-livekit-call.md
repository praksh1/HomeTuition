# A real two-person LiveKit call, and the token TTL it made safe to fix

- Date: 2026-09-07
- Agent: claude
- Branch: `claude/livekit-trial`
- Base commit: `dcfd536`
- Status: complete

## Requested

> "resume - but you focus on LiveKit Cloud for now! I have codex update the premium design and logo"

The largest unproven claim in the whole LiveKit trial was that **no media had ever flowed** — no
camera opened, no packet sent, no token presented to a LiveKit server. Every green suite tested
either the interface over a fake provider or tokens that were never used. That is what this
closes.

## Changed

**`livekit-server` is buildable here.** LiveKit's SFU is open source and Go is installed, and
`proxy.golang.org` is directly reachable from this environment. `git clone --branch v1.13.6` and
`go build ./cmd/server` produces the same binary LiveKit Cloud runs. No account, no card, no
credentials.

**New — `artifacts/sikshya/scripts/livekit-live/run.mjs`.** A genuine two-person call: the local
SFU, the real API minting real join tokens against it, two Chromium browsers with synthetic
cameras, and the real `lib/video` underneath the real component (no alias — that is the whole
difference from `scripts/livekit-tests`). 37 assertions.

**Changed — the LiveKit join token now expires with the class.** `livekitProvider.ts` gained
`ttlSecondsFor`; `JoinOptions` gained an optional `expiresAt`; the room route passes
`cutoffAt(session)`. A sixty-minute lesson now mints a seventy-minute token instead of an
eight-hour one.

**New — `artifacts/api-server/src/lib/video/tokenTtl.test.ts`**, 5 tests on the TTL rule.

**CI** installs `livekit-server` from a release (non-fatal) and runs the suite;
`test:livekit-live` registered in `package.json`.

**Docs** — `VIDEO.md`: the "no media has ever flowed" section is replaced by what was proved and
how; the security finding moves from "deliberately not fixed" to fixed, with the experiment that
justified it.

## Decisions and assumptions

**A local SFU rather than LiveKit Cloud.** It is the same software, so the *code* is proved and
it runs in CI with no secrets. It is explicitly not the internet: no latency, no packet loss, no
TURN relay, no cloud region, and no answer on cost. Said plainly in `VIDEO.md` rather than
letting a green suite imply otherwise.

**Frames decoded, not tiles rendered.** A DOM query cannot tell a working tile from a black one.
The suite asserts `framesDecoded` rising on the inbound RTP stream, and then — because that
still does not prove a person sees anything — draws the live `<video>` into a canvas and reads
the pixels back.

**The token TTL was changed only after measuring.** Detail below.

**The suite skips itself when the binary is absent**, rather than failing. A red run a developer
cannot fix is one people learn to ignore.

## Verification

Against a real Postgres, a built API, the built web app and a real SFU.

| Check | Result |
|---|---|
| `pnpm run typecheck` (4 packages) | pass |
| api-server unit tests | 453 pass (was 448; +5 TTL) |
| app unit tests | 244 pass |
| `scripts/livekit-live` (new) | **37 pass** |
| `api-server/scripts/video-tests` | 42 pass |
| `sikshya/scripts/livekit-tests` | 82 pass |
| design ratchet | 111 hex / 338 sizes, unchanged |

What the live suite actually establishes, all of it new:

- Media flows both ways — `framesDecoded` rises on both browsers.
- The tiles paint a picture: 100% of sampled pixels non-black, `readyState` 4, `currentTime`
  advancing in real time.
- **Every incoming camera is 640×480** — the 480p cap measured at the receiving end, not merely
  configured.
- One room per class, named `sikshya<id>`, so attendance evidence still correlates.
- Only the teacher's token carries `SCREEN_SHARE`, read from the server's own permissions.
- Audio-only stops *incoming* video too, with the call still up.
- Muting and leaving reach the other browser and the server's roster.
- The API secret is in no response body and no decoded JWT payload.

## Problems and surprises

**The screenshot showed two black video tiles.** Frames were decoding, so this was either a
headless compositing limitation or a bug that would ship a black call. Probed it directly: both
elements were 640×480, unpaused, `readyState` 4, `currentTime` advancing, and 100% non-black
pixels when drawn into a canvas. Headless Chromium does not composite video into a screenshot.
Turned into a permanent assertion, and the saved screenshots now carry a comment saying the
black is expected so nobody later "fixes" it.

**I nearly reported the opposite conclusion on token expiry.** A first experiment waited 2.5
seconds past expiry, saw the server accept the token in *both* dev and production mode, and
looked like proof that LiveKit ignores `exp` entirely. It does not. The join check allows
roughly **sixty seconds of clock-skew leeway**: 5s past expiry is accepted, 75s past is a clean
401, and garbage is refused immediately. Testing inside the leeway and reporting it would have
been a fabricated finding. The five-minute TTL floor exists because of this.

**Postgres was killed three times mid-run**, producing failures that looked like app bugs — once
a registration 500, once a video suite reporting no media. Cause: the data directory was under
the session scratchpad, and something in this environment periodically resets permissions on
`/tmp/claude-0/...`; a running Postgres then cannot stat its own directory and aborts. Moved to
`/var/lib/postgresql/fadko`, and it has been stable since.

**Four fixture mismatches before the suite ran at all** — teacher registration needs a subject
and bio; the approval column is `approval_status`, not `is_approved`; a teacher needs an active
subscription tier; and `POST /sessions` takes `subject/topic/date/duration/price`, not the
screen's field names. The first run reported eleven failures, nine of them "no video flowed",
all caused by a teacher with no teaching plan three steps earlier. Added a `must()` helper so a
broken fixture stops the run instead of cascading into false video failures.

**`canPublishSources` holds numeric enum values at runtime** and only renders as
`["CAMERA","SCREEN_SHARE"]` when something calls `toJSON`. An assertion matching the printed
form reported that the teacher could not share a screen while the token plainly said they could.
Now compared against the SDK's own `TrackSource` enum.

**The TTL assertion caught a stale build.** It reported 480 minutes — the old ceiling — because
the suite spawns `dist/index.mjs` and I had not rebuilt after changing the source.

## Fabrications found

None found in the product. One was very nearly written *into* the documentation by me: see the
clock-skew leeway above, where a too-short wait would have recorded "LiveKit does not enforce
token expiry" as a finding. Caught by re-testing past the leeway before writing anything down.

## Deliberately not changed

- **Daily.** Untouched. `expiresAt` is optional on `JoinOptions` precisely so Daily's token
  lifetime, which Daily sets, is unaffected.
- **The whiteboard, membership, payments, the classroom socket.** Untouched.
- **`scripts/livekit-tests`** keeps its fake provider. It produces failure states on demand —
  a dropped connection, a refused camera — which a real server cannot be asked for. The two
  suites answer different questions and both are worth having.
- **No webhook ingestion for LiveKit.** Still Daily-shaped and still off.
- **Nothing deployed, nothing merged to `main`.**

## Remaining risks / next pickup point

**LiveKit Cloud itself is still untested.** The local SFU proves the code; it does not prove the
internet. The owner's own two-browser test through LiveKit Cloud remains the next real step, and
it needs the three credentials entered in Railway → Variables.

**Cost at scale is still unanswered** — 108,000 participant-minutes per teacher per month is the
reason for the whole exercise, and nobody has priced it on LiveKit Cloud. `HANDOVER.md` §8.6.

**No real phone browser.** Chromium at phone dimensions reproduces layout, not a weak radio.

**The 60-second leeway is LiveKit's, not ours.** If a future LiveKit release changes it, the
five-minute floor still covers it comfortably, but the number is written down in `VIDEO.md` as
measured on v1.13.6 rather than as a guarantee.
