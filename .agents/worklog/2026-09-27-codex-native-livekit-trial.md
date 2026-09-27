# Native LiveKit migration trial

- Date: 2026-09-27
- Agent: Codex
- Branch: codex/native-livekit-trial
- Base commit: fcfa13b
- Status: in progress

## Requested

Continue implementation and testing with laptop web first-class, phone browsers usable for current testing, and installed iOS/Android apps the intended phone experience after store release.

## Changed

Reused a clean managed worktree for this isolated trial, leaving the large identity/closure worktree untouched. Added a strict native-media capability header and passed it to room joining and teacher start. Old/unknown phone builds continue to receive Daily; the current LiveKit provider remains web-only even if a client claims the new capability. Recorded the future app-directed release policy and the migration gates.

## Decisions and assumptions

The header is compatibility data only; authenticated class membership and moderator rights remain server-side. The native provider will not be switched until a build with LiveKit's native SDK exists and physical-device behavior is verified. The current Daily SDK must be replaced, not installed alongside LiveKit's conflicting WebRTC fork.

## Verification

Focused provider-selection suite passed 19/19. Full API suite passed 735/735, API build and `git diff --check` passed. Initial API typecheck failed because this fresh worktree had not built shared library declarations. After `pnpm run typecheck:libs`, API typecheck passed. No provider service, app store, Preview or production deployment was changed.

## Problems and surprises

The managed worktree initially lacked generated `lib/db/dist` declarations; this was a build prerequisite, not a code regression. Native SDK integration and on-device behavior remain untested.

## Fabrications found

None found in this slice.

## Deliberately not changed

No Daily removal, LiveKit native installation, provider switch, account-closure activation, app-only phone-web gate, purchase or real classroom call.

## Remaining risks / next pickup point

Replace Daily's native WebRTC fork with LiveKit in this isolated app build, add the capability header only from that build, then prove Android/iOS build and physical camera/mic/whiteboard journeys. Keep old Daily builds served until a safe retirement window is established. Permanent closure remains gated.
