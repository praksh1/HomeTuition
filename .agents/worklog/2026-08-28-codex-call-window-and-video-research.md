# Resizable classroom call window and video-provider research

- Date: 2026-08-28
- Agent: Codex
- Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Base commit: `adda852`
- Status: complete (owner's cross-device touch verification still required)

> **Production follow-up, 2026-08-29:** The statement below that production was not deployed was
> accurate when this task ended. The owner subsequently authorized the real release. Production
> deployment and verification are recorded in
> [`2026-08-29-codex-production-release.md`](./2026-08-29-codex-production-release.md).

## Requested

- Fix the current Daily call window before making unrelated application changes.
- Give teacher and student a way to hide, restore, resize, minimize/maximize, and move the call
  without losing the connection or blocking the Excalidraw board.
- Research the serious Daily alternatives in depth, including managed providers, low-level media
  infrastructure, self-hosted open source, peer-to-peer, and building an SFU from scratch.
- Keep a complete account for handoff between Codex and Claude.

## Changed

### Teacher and student classroom UI

Changed only:

- `artifacts/sikshya/app/(teacher)/classroom/[id].tsx`
- `artifacts/sikshya/app/(student)/classroom/[id].tsx`

Both classrooms now use the same four-state app-owned call shell:

- **Hidden:** Daily remains mounted and connected but its shell uses `display: none` and cannot
  intercept board touches. A labelled **Show call** pill restores it.
- **Small:** a draggable thumbnail intended to preserve the whiteboard working area.
- **Medium:** a larger movable call window intended for Daily's mic, camera, reactions, hand
  raising, and screen-share controls.
- **Full:** the call fills the usable classroom stage for a readable screen share, with a restore
  control back to the last windowed size.

Implementation details:

- Replaced the single `videoExpanded` boolean with a typed `VideoWindowSize` state.
- Remembered the last visible and last non-full sizes so Hide/Show and Full/Restore return to the
  user's previous choice.
- Added a 44-pixel-token app header to the call shell. It contains a labelled Hide action, a
  Small/Medium toggle, a Full/Restore toggle, and a separate drag zone.
- Kept `VideoCall` mounted through every size and visibility change. No room token, Daily room,
  provider lifecycle, or teardown behavior was altered.
- Kept transparent overlay carriers on `box-none`; hidden/chat video shells use `pointerEvents`
  `none`; only visible controls capture touches.
- Recomputed warning-banner placement from the current window state so the alone-in-call notice
  does not sit on top of the call controls.
- Restored a working video visibility control in the classroom HUD. It now hides/shows the shell
  rather than ending or leaving the Daily call.
- Used only existing design spacing, color, radius, typography, elevation, and hit-target tokens.

### Provider research

Added `.agents/backlog/video-provider-research-2026-08-28.md` with:

- an explicit Sikshya workload and revenue model;
- public list-price estimates for Daily, Stream Video, JaaS, Cloudflare RealtimeKit and raw SFU,
  Tencent RTC, Agora, 100ms, ZEGOCLOUD, VideoSDK, AWS Chime, Azure, Twilio, Vonage, Whereby,
  LiveKit Cloud, Zoom, and Sendbird;
- 9-million and 18-million monthly participant-minute scenarios for the proposed 10,000 daily
  users;
- a feature/fit assessment for cheap Android, Expo/React Native, screen share, reactions, raise
  hand, app-owned PiP, and teacher permissions;
- a five-level build-versus-buy analysis: app-owned UI over managed media, raw managed SFU,
  self-hosted open source, P2P for 1:1, and an SFU from scratch;
- a device/network proof-of-concept scorecard;
- first-party source links and an explicit note that no provider migration is authorized.

The original `.agents/backlog/video-provider-pricing.md` was retained rather than erased and
marked as superseded for decision-making. `.agents/memory/MEMORY.md` now points to the expanded
research and staged recommendation.

## Decisions and assumptions

- **Daily stays active.** Research did not authorize a migration, account creation, dependency
  installation, or backend/provider change.
- **Stream Video is the strongest first experiment**, not an automatic production selection. It
  has $100 monthly free usage, React Native/Expo plus web UI components, screen share, reactions,
  raise hand, roles, moderation, and controllable PiP.
- **JaaS is the strongest repeated-use billing model** because it bills monthly active devices,
  but it needs a cheap-Android proof and a written 10,000-device quote.
- **Cloudflare raw SFU or self-hosted LiveKit are later technical-team choices.** Cheap server
  arithmetic alone was rejected as misleading because concurrency, redundancy, TURN, regions,
  monitoring, upgrades, and on-call labor are real production costs.
- Small/Medium/Full is used instead of freeform corner resizing because discrete sizes are
  predictable on touch screens, keep 44-pixel hit targets, and avoid expensive continuous
  relayout of a live video embed on budget phones.

## Verification

Passed:

- `pnpm --filter @workspace/sikshya run typecheck`
- `pnpm --filter @workspace/sikshya run test` — 154/154 tests passed; existing Node module-type
  warnings remain.
- `pnpm --filter @workspace/sikshya run lint:design` — baseline unchanged at 223 hex literals and
  429 raw font sizes across the existing repository; no new leaks.
- Root `pnpm run typecheck` — TypeScript build passed. The root artifact filter still reports no
  matching projects, so the focused Sikshya typecheck above is the direct application proof.
- `pnpm --filter @workspace/sikshya run build` with the public production API URL — static Expo
  web export completed and confirmed the API endpoint and Sikshya identity.
- `git diff --check` — no whitespace errors; Windows line-ending notices only.
- Wrangler deployment dry run — 242 static files discovered and configuration accepted.
- Branch preview deployment — successful. HTTP inspection confirmed that the preview bundle
  contains the new Hide/Medium/Full controls.
- Production isolation — production returned HTTP 200 and served a different bundle from the
  branch preview. Production was not deployed or changed.
- Browser smoke check — the deployed preview loaded as Sikshya in the existing signed-in teacher
  session with no application error. Only existing Expo web warnings appeared. A paid/current
  classroom was deliberately not started because that would mutate real session state.

Preview for owner verification:

- <https://claude-excalidraw-whiteboard-sync-gjoqaz-hometuition.praksh-dhakal.workers.dev/>

Manual verification still required on the teacher laptop and student phone:

- Small → Medium → Full → Restore;
- drag Small and Medium without losing board strokes;
- Hide from the call header and HUD, then Show Call;
- teacher screen share readable in Full;
- Daily controls usable in Medium/Full;
- chat sheet and waiting/alone notices do not cover the app call controls.

## Problems and surprises

- The first production build attempt in the sandbox failed because the deployment API/domain
  environment was intentionally absent. Retried with the public API URL.
- A subsequent build hit a transient OneDrive `EBUSY` lock on `pdf.worker.min.js`. Retrying after
  the lock cleared completed successfully; no source change was needed.
- One retry used a nonexistent `build:web` script. The actual package script is `build`; the
  corrected command passed.
- Normal sandbox verification initially hit OneDrive reparse/permission errors while reading
  `node_modules`. Running the same repository commands with approved access succeeded.
- `pnpm exec wrangler` failed because Wrangler is not a repository dependency. The documented
  ephemeral `npx --yes wrangler@latest` path used Wrangler 4.127.1 and both dry-run and deploy
  succeeded. No dependency was added to the repository.
- Formatting initially failed after the final UI labels and research document were added. Prettier
  was applied to the touched files, then typecheck/tests/design verification passed.
- Browser smoke testing could reach the signed-in teacher dashboard, but entering the classroom
  would require starting a real scheduled class. That mutation was not inferred from the request;
  cross-device interaction verification remains with the owner.

## Deliberately not changed

- No Daily configuration, SDK, room creation, token, provider contract, or native call lifecycle.
- No WebSocket, membership, booking, payment, session teardown, or database logic.
- No internal Daily chat/PiP behavior beyond the already-established configuration.
- No student Materials/Book action was invented; the current task was the call window.
- No provider account was created and no Stream/JaaS/Tencent/Cloudflare media dependency was
  installed.
- No production deployment.
- The paused `is_online` cleanup remains in the pre-existing stash and was not restored or edited.

## Remaining risks / next pickup point

- Owner must perform the real two-device touch/call test at the preview URL. Automated checks
  cannot prove Daily's responsive internal controls at every embed size or a teacher screen share
  on the student's physical phone.
- If Small is too narrow for any useful Daily view, keep it preview-only and use Medium for
  controls; do not enlarge Small until owner feedback confirms the whiteboard tradeoff.
- If three discrete sizes are not sufficient, add a small number of snap points rather than a
  continuously resizing embed on low-end Android.
- Do not begin a provider migration without explicit owner approval. The next safe provider task
  is an isolated Stream Video proof of concept followed by JaaS, scored on the same Nepal-device
  test matrix.
- The unrelated dead `is_online` cleanup is still paused and must not be mixed into this classroom
  verification commit.
