# Production-test release candidate

- Date: 2026-09-04
- Agent: claude
- Branch: `claude/production-test-release-candidate`
- Base commit: `b29bb07` (itself branched from `origin/claude/staging-user-journey-audit`)
- Status: in progress

## Requested

One release candidate that lets the owner test the real Daily classroom on the main production
domain **without** disabling the configured payment gateway for the public and **without**
inventing revenue. Five parts:

- **A** — reconcile, don't rebuild: confirm the branch still carries correction items 1–6 and
  prove each with a targeted test rather than re-implementing it.
- **B** — complete correction item 6, the honest call window. The owner reports the minus button
  as doing nothing.
- **C** — an operator-granted, auditable, expiring **test student access**, modelled on the
  existing teacher test access, so the owner can walk a real booking without opening free
  payment to the public.
- **D** — the test gates: concurrency, authorization, revenue exclusion, expiry, kill switches.
- **E** — this log, the docs, and the closing report.

Two blocking corrections from Codex had to be cleared before any of that:

1. `b29bb07` labelled every outside-window refusal `409 / expired: true`, and both classroom
   screens treated any 409 as terminal. A paid student or a teacher who was merely **early** was
   shown an expired screen.
2. `sendVerificationEmail` read `isEmailConfigured()` but still called `issueToken` when mail was
   unconfigured, burning a token and a cooldown that could produce a 429 the moment a provider
   was switched on.

Standing constraints: push only to this branch; do not touch `main`,
`codex/staging-preview-integration`, `claude/stream-video-poc`, Railway, Cloudflare, production
data, credentials, DNS or billing; Stream stays isolated at `8550631` and unmerged; **Daily
remains the production video provider** and its room/token logic is not altered; no deploy, no PR.

## Changed

### Blocking correction 1 — "not yet" is not "never again" (commit `7abe06d`)

| File | What |
|---|---|
| `api-server/src/lib/sessionStart.ts` | `StartCheck` gained `code: "too_early" \| "finished" \| "cancelled"`, and the two early branches carry `opensAt`. All seven refusal sites tagged. |
| `api-server/src/routes/sessions.ts` | New `timingRefusal()` builds both 409 bodies from one place; `expired` is now `code !== "too_early"` rather than always true. |
| `sikshya/utils/roomRefusal.ts` *(new)* | Pure reader: status + body → `waiting \| over \| error`, plus the retry delay. An unknown or missing code falls back to the old `expired` flag, so an older server is still understood. |
| `sikshya/utils/sessionWindow.ts` | The client mirror gained the same `code`, because it shared the server's fault. |
| both `classroom/[id].tsx` | A non-terminal lobby with the real opens-at sentence and a retry when the door opens; terminal screens reserved for classes that genuinely ended. |

### Blocking correction 2 — a resend nobody can receive leaves no trace

| File | What |
|---|---|
| `api-server/src/lib/accountSecurity.ts` | Short-circuits **before** `issueToken` when mail is unconfigured: nothing is minted, no cooldown spent, no older token invalidated. Returns `{ sent: false, rateLimited: false, configured: false }`. |
| `api-server/src/routes/auth.ts` | A configured provider that still refuses now says so, instead of sending the operator to check an environment variable that is already correct. |

### The classroom crash found only by rendering (commit `7abe06d`)

Both classrooms returned `null` for the wrong role on a line **above about forty hooks**. On a
cold open — a refresh, or a shared link — the first render ran three hooks and the next ran
forty, and React threw error 310: *"Something went wrong. Please reload the app."* The guard is
now deferred past every hook. This is the `authguard-role-cast-crash` hazard already in memory,
in two more files. It was **pre-existing**, proved by reproducing it on a code path this task had
not touched.

### Item B — the call window

| File | What |
|---|---|
| `sikshya/utils/callWindow.ts` *(new)* | One pure module, shared by both classrooms: the four states, the reducer, the geometry, and what each state offers. No React, no styles, no imports. |
| `sikshya/utils/callWindow.test.ts` *(new)* | 24 tests. |
| both `classroom/[id].tsx` | `useReducer(callWindowReducer)` replaces the local `useState` size; the geometry, the drag clamp and the rotation re-clamp all come from the shared module. Compact renders one **Restore**; normal and full render the original three. |
| both `classroom/[id].tsx` styles | `callFrameBody` gained `overflow: "hidden"`, `callFrameHeader` gained `zIndex: 1`. **See below — this was the actual bug.** |
| `sikshya/scripts/lobby-tests/run.mjs` | The window states are now rendered and pressed for **both** roles at both viewports, with unforced clicks. |

**Minus is now a snap.** From any visible size it goes to `compact` *and returns the window to
the bottom-right corner*. It used to toggle two docked sizes about a finger's width apart and
leave the window wherever it had been dragged, which from the outside is a dead control.

## Decisions and assumptions

- **`compact` offers exactly one control.** Three 44-point buttons do not fit across a 132-point
  window; they render as a row of half-buttons nobody can hit. Restore is the one thing somebody
  wants from a thumbnail, and Hide stays reachable from the classroom's own HUD.
- **Restore goes to `normal`, not to full screen.** A thumbnail's Restore means "give me the
  window back"; full screen would bury the whiteboard, which is the product.
- **`hidden` is a painted state, not an absent one.** The call stays mounted through hide,
  minimise, maximise, drag, rotation and the chat overlay. The state machine has no "off", and a
  test walks 40 actions asserting it cannot reach one.
- **An unknown refusal code reads as "over".** A screen that waits forever for a class that
  finished is worse than one that ends a few minutes early, and the person can reopen it.
- **The retry sleeps at most five minutes** even when the door is a day away. A backgrounded tab
  throttles timers and a dozing Android may not run one at all, so "sleep for 26 hours" is a
  promise this app cannot make. It wakes and checks the clock.

## Verification

Run against Postgres 16 on `127.0.0.1:55432` and an API on `:8080` with `VIDEO_PROVIDER=echo`,
`NODE_ENV=test`, `ALLOW_TEST_TEACHING_ACCESS=true`.

| Command | Result |
|---|---|
| `pnpm run typecheck` (4 packages) | clean |
| `pnpm --filter @workspace/api-server run test` | **286 / 286** |
| `pnpm --filter @workspace/sikshya run test` | **208 / 208** |
| `pnpm --filter @workspace/sikshya run lint:design` | 205 hex / 418 sizes — unchanged, no new leaks |
| `api-server/scripts/journey-audit/run.mjs` | **57 / 57** |
| `pnpm --filter @workspace/sikshya run test:lobby` | **90 / 90** |

`test:lobby` renders in headless Chromium at 1280×800 and 360×740, for the teacher and the
student, and now presses every window control **without** `force`.

**A browser is not a phone.** Nothing above is evidence about iOS or Android hardware, about a
real Daily call, about a payment gateway, or about two devices in one class.

## Problems and surprises

**The window controls were drawn, and dead — and forced clicks hid it.** After wiring the shared
model in, the rendered rectangle refused to change: 132×118 through Restore and through maximise,
at both viewports. The model was right (24/24 in isolation) and the wiring was right, so the
press was not arriving. Dumping the subtree found it:

```
DIV[video-provider-unknown] rect=1141,595 130x72   ← the call body
  DIV[]                     rect=1165,561  82x140  ← its text, 34px ABOVE its own box
BUTTON[video-restore-btn]   rect=1207,551  64x44   ← buried under that text
```

`callFrameBody` did not clip. A message too tall for a 132-point preview rendered 140 points high
in a 72-point box, centred, so it overflowed **upwards** across the header and took every tap
meant for Hide, minus and maximise. The buttons were painted, visible, and inert — which is
exactly what the owner reported and which no unit test could ever have seen.

The suite had been using `click({ force: true })`, which skips Playwright's hit-target check.
That is how a real defect reported success while the events went to a paragraph of text. Every
press in the suite is now unforced, and a blocked one fails naming what is in the way.

`overflow: hidden` on the body and `zIndex: 1` on the header fix it in both classrooms.

## Fabrications found

None found in this session so far.

## Deliberately not changed

- **Daily.** No room logic, no token logic, no provider selection. `VIDEO_PROVIDER` still decides
  and still defaults to Daily.
- **Stream.** Untouched at `8550631` on its own branch, not merged, not referenced.
- **Booking atomicity and the payment mode rules.** Nothing in this session writes an enrolment
  or reads a gateway.
- **`main`, `codex/staging-preview-integration`, Railway, Cloudflare, production data.**
- The classroom's own chat, board, socket and attendance behaviour.

## Remaining risks / next pickup point

- **Rendered ≠ phone.** The window has been proved in Chromium at two sizes. A real Android
  phone, a real rotation and a real Daily call are still unmeasured.
- Items **A**, **C**, **D** and the rest of **E** are still open. Next: item A — reconcile
  correction items 1–6 against the branch with targeted evidence, then item C.
