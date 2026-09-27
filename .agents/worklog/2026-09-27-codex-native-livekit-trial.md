# Native LiveKit migration trial

## Clean Android packaging check after the first checkpoint

A disposable clone of commit `39d479d` under the physically shorter `%TEMP%\f27` path used the committed, non-hoisted pnpm configuration. Offline frozen-lockfile install, Expo Android prebuild, and arm64 `assembleDebug` completed successfully. Verified `app-debug.apk` exists (86,793,952 bytes). The build did not require changing the trial branch or deploying anything. It omitted an explicit API origin, so it cannot sign in or make a real call; a device-test binary must point at an isolated trial API. No device or emulator was available, so this is packaging evidence only. iOS compilation and real installed-app teacher/student call, screen-share, whiteboard, chat, permission, audio-route, and reconnect journeys remain unverified. Keep the trial off in deployed environments.

The first disposable build used a hoisted package layout and failed later native compilation; the hoisted layout also has a documented app-startup crash and must not be adopted. Its result is not release evidence. The successful check used normal dependencies and a genuinely shorter checkout rather than a `subst` alias.

## Progress update after the first checkpoint

Replaced native Daily packages and Expo plugin with the official LiveKit React Native SDK, its WebRTC module and Expo plugin on this isolated branch. Archived the previous native Daily component and unused experiments as text. Built a native LiveKit room adapter with token join, audio session, camera/microphone permissions and controls, watched-teacher callbacks, local media state and Fadko class chat. Added a server opt-in (VIDEO_NATIVE_LIVEKIT_TRIAL=1) and a build opt-in (EXPO_PUBLIC_NATIVE_LIVEKIT_TRIAL=1), both default-off; the exact native capability header is still required and grants no class rights.

Verification for this slice: frontend typecheck and 568/568 unit tests passed; backend typecheck and full 736/736 suite passed; Android and iOS JS exports, Expo Android prebuild, direct web export and LiveKit Android native module compilation passed. The existing browser LiveKit journey passed 135/135 checks at phone and laptop widths. The normal web build script requires a deployment domain absent from this isolated worktree. Full Android assembleDebug remains unverified after a Windows CMake command-launch failure in unrelated Worklets and Screens tasks; the initial SDK-location error was fixed using ignored local.properties. No physical-device test, Preview/production deployment, purchase or real payment occurred.

Do not distribute this trial binary: its native Daily entry is deliberately unavailable and the ordinary API still routes phones to Daily. Native screen sharing and full device call parity remain unfinished. Resolve the Android build path, make iOS and Android development binaries, then run real teacher/student calls against a separately opted-in trial API before considering release. The earlier sections below record the first checkpoint and should not be mistaken for current completion.

Retry after checkpoint: mapped this exact worktree temporarily to `L:` and ran `assembleDebug --no-daemon` from that shorter path. Gradle still canonicalized the dependency task paths back to the long checkout and failed with `CreateProcess error=2` when launching generated `prefab_command.bat` for React Native Screens (the earlier run also implicated Worklets). The temporary drive mapping was removed. This does not establish a LiveKit SDK failure or produce an installable APK; a physically short checkout or clean native CI build remains necessary.

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
