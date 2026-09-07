# Move the LiveKit credentials check off the terminal and onto a screen

- Date: 2026-09-07
- Agent: claude
- Branch: `claude/livekit-trial`
- Base commit: `e54f141`
- Status: complete

## Requested

> "I am back and forth and all over the place - and I need you to do all you can with me doing
> minimal stuff … I need you to finish this from here as well - I don't need to be doing all the
> cmd and coding and stuff!!"

and then, after a second failed command:

> "please don't make me work any more cmd lines - i know you have the capabilities to do all of
> that- I keep getting errors like these"

The owner had pasted their LiveKit keys into `.env` and tried to run the preflight this project
told them to run. It failed twice, and neither failure was about LiveKit:

1. `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` — the script exists on `claude/livekit-trial` and their
   checkout was on an older branch. **My instruction was incomplete, not their mistake.**
2. A PowerShell parse error — I handed over a `cmd.exe` one-liner using `&&` and `cd /d`, and
   they were in PowerShell, where `&&` is not a statement separator and `cd /d` does not exist.

Two evenings lost to the delivery mechanism rather than the thing being checked.

## Changed

**New — `artifacts/api-server/src/lib/video/diagnose.ts`.** All the judgement, in one place, so
the two surfaces cannot disagree. `inspectSettings` is pure (no network, clock or filesystem) and
therefore unit-testable; `diagnoseVideo` composes settings → token signing → asking LiveKit, each
step gating the next. `WHERE` carries the one thing that legitimately differs between surfaces:
Railway for the deployed server, `.env` for a checkout.

**New — `GET /admin/video/check`** in `routes/admin.ts`, beside the storage check it mirrors.
Gated by the existing `requireAuth, requireAdmin, requirePasswordChanged`. Writes
`admin.video.checked` to the activity log with verdicts only, never values.

**New — `VideoCheck` card** in `app/(admin)/index.tsx`, directly under `StorageCheck`. Reuses
that component's existing style keys, so the design ratchet stayed at 111 hex / 338 sizes.

**Rewritten — `artifacts/api-server/scripts/livekit-check.mjs`.** Now a printer over
`diagnoseVideo`; it decides nothing. Run with `--experimental-strip-types` so it can import the
`.ts` module directly (flags added to both `livekit:check` scripts).

**New tests.** `diagnose.test.ts` (14 unit tests) and `scripts/video-check/run.mjs` (17 browser
assertions), the latter registered as `test:video-check` and wired into `deploy-web.yml` next to
`test:storage-check`.

**Docs.** `VIDEO.md` step 3, `LOCAL_SETUP.md`, `.env.example` now lead with the button and
mention the terminal second.

## Decisions and assumptions

**Three verdicts, not two.** `ok` / `wrong` / `unknown`. The middle one exists because "the
settings are right but this server cannot reach livekit.cloud" is not a verdict on the
credentials, and painting it red sends somebody to regenerate a key that was fine. This
repository's own build environment produces exactly that case.

**The check runs even when `VIDEO_PROVIDER` is still `daily`.** That is the state the owner is
actually in — keys pasted, switch not flipped — and "these are good, you just haven't switched
over" is the most useful thing this can say that day. Refusing to look until the switch is on
would withhold it.

**The secret is a length, never a value**, in the API response as well as on screen. Asserted
both ways in the browser suite: a screen could hide something the API had already sent.

**Amber for the provider case, not red.** Nothing is broken when the switch is off.

## Verification

Against a real Postgres 16 started for this work, a built API and the built web app — not mocks.

| Check | Result |
|---|---|
| `pnpm run typecheck` (4 packages) | pass |
| api-server unit tests | 448 pass |
| app unit tests | 244 pass |
| design ratchet | 111 hex / 338 sizes, unchanged |
| `scripts/video-check/run.mjs` (new) | 17 pass |
| `scripts/storage-check/run.mjs` (same screen) | 10 pass |
| `scripts/ticket-browser/run.mjs` (same screen) | 23 pass |
| `scripts/admin-tests/run.mjs` | 58 pass |
| `scripts/video-tests/run.mjs` | 42 pass |

**Rendered, not just asserted.** Three states screenshotted at 393×852: wrong settings,
unreachable LiveKit, and correct-but-not-switched-on. Two bugs came out of looking at those and
nothing else caught them — see below.

The browser suite needs no internet: case B points `LIVEKIT_URL` at a port opened and immediately
closed, so `RoomServiceClient` gets ECONNREFUSED from loopback, which reaches the same branch of
`describeReachFailure` as a firewall.

## Problems and surprises

**A test that asserted a leak using an English word.** `assert.ok(!text.includes("short"))` failed
against the message "too short to be a real one". My test was wrong, not the code. A substring
check for a leak only means something when the needle could not have come from the prose; both
test files now use values like `Zq7x` that cannot.

**Every remedy pointed at a destination, not a route — and the first version of the browser test
passed anyway.** In the case where all three variables are *present* but two are malformed, the
remedies read "copy it again from the LiveKit dashboard" and "change https:// to wss://", neither
saying *where*. That is precisely the failure CLAUDE.md records, and my assertion (`does "Railway"
appear anywhere on the page?`) passed by accident in other cases. Fixed by threading `WHERE`
through every remedy, and the assertion now checks **each** finding's fix individually.

**Two bugs found only by looking at the rendered card:**

1. The headline restated the first failing finding verbatim, so the same sentence appeared twice
   within four lines — a third of the card on a phone.
2. With both `provider` and `reach` unknown, the headline led with "could not reach LiveKit" and
   buried "video is still on Daily". The second is the one the reader must act on. Reordered.

**"still on daily".** The headline printed the raw environment value. `providerLabel` now maps it
to Daily / LiveKit; every other line on that screen is plain English.

**`pkill -f` took down the Postgres I had started**, mid-verification, producing a registration
failure that looked like an app bug. It was not. Restarted and re-ran everything.

## Fabrications found

None found. Every finding on the screen is computed from `process.env` on the server that
answered, and the network verdict comes from an actual `listRooms()` call. No row is invented,
and there is no placeholder path — the card shows nothing at all until the button is pressed.

## Deliberately not changed

- **The terminal script still exists.** It reads a local `.env`, which the web route cannot; it
  just no longer holds any judgement of its own.
- **Daily.** Untouched, per the standing instruction that it must remain instantly switchable.
- **The whiteboard.** Untouched.
- **`StorageCheck`.** Left alone rather than refactored to share the new style keys — it works,
  and widening this diff into a neighbouring component buys nothing.
- **The 8-hour token TTL.** Still open, still recorded in `VIDEO.md`.

## Remaining risks / next pickup point

**The two branches that need livekit.cloud have still never run.** "LiveKit accepted the
credentials" and "LiveKit refused the key and secret" are unit-tested at the string level only;
the egress policy here blocks livekit.cloud, so neither has been exercised end to end. Everything
either side of them has.

**This is on `claude/livekit-trial`, which is not deployed.** The card cannot be pressed on the
live site until this branch reaches `main` — and a push to `main` deploys. That merge is the
owner's call and has not been made.

**The one thing that cannot be automated away:** I can never see or set their LiveKit secret. It
has to be entered by them. The cheapest place is Railway's Variables tab in a browser — no shell,
no branch, no `pnpm.cmd`.
