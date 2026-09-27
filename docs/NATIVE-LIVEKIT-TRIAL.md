# Native LiveKit trial (not deployed)

## Update: clean Android arm64 APK built, device parity still open

On 2026-09-27, a disposable local clone of commit `39d479d` at `C:\Users\missk\AppData\Local\Temp\f27` installed the locked dependencies with the project's normal (non-hoisted) pnpm layout, ran `pnpm exec expo prebuild --platform android --no-install`, and completed `gradlew.bat assembleDebug -PreactNativeArchitectures=arm64-v8a --no-daemon --console=plain --quiet` with exit code 0. The generated debug APK was present at `artifacts/sikshya/android/app/build/outputs/apk/debug/app-debug.apk` (86,793,952 bytes). The Android SDK was supplied by an ignored `android/local.properties` file in the disposable clone. No repository dependency-layout change was needed.

An earlier disposable build with `nodeLinker: hoisted` is **not** release evidence: this project documents a startup crash with that layout, and the temporary installation proved incomplete. Do not copy that setting into the branch. A mapped `L:` drive did not shorten Gradle's canonicalized paths; a physically shorter checkout did.

The APK is a compilation artifact only, not a tested or distributable app. This packaging run intentionally omitted `EXPO_PUBLIC_API_URL`/`EXPO_PUBLIC_DOMAIN`; without an explicit API origin a native client falls back to relative `/api` and cannot sign in or join a room. No Android device or emulator was attached on this host, no iOS binary was built, and no installed-app teacher/student call, reconnection, screen share, whiteboard or chat journey was verified. A later device-test binary needs an explicitly chosen, isolated trial API origin and both trial switches, then a real-device test against that API. Keep both trial switches off in deployed environments and keep the native trial unmerged until the hard gates below pass.

## Update: isolated native adapter, still not a release candidate

The trial branch now replaces native Daily packages with the official LiveKit React Native SDK, WebRTC module and Expo plugin. The old native Daily implementation is archived as text under artifacts/sikshya/_unused. This change is only in the isolated branch; the current shipping phone app is untouched.

The new native adapter joins with a server token, manages the native audio session, renders a stage and participant strip, reports microphone/camera status, handles teacher presence, and uses Fadko's class chat. Native screen-sharing parity is not implemented yet.

Two independent switches remain off by default. The trial API needs VIDEO_PROVIDER=livekit and VIDEO_NATIVE_LIVEKIT_TRIAL=1. A purpose-built trial binary needs EXPO_PUBLIC_NATIVE_LIVEKIT_TRIAL=1 to send its native capability header. Old builds omit the header and continue receiving Daily. This trial binary intentionally cannot open a Daily room, so it must not be installed against the ordinary API.

At the first checkpoint, TypeScript, 568 frontend unit tests, Android and iOS JavaScript exports, Expo Android prebuild, LiveKit Android Java/Kotlin compilation, and direct web export passed. A full Android APK was then unverified because Worklets and Screens CMake tasks on the long Windows worktree could not launch their generated prefab command files. The later clean short-path build above resolves that packaging check. This Windows host cannot build an iOS binary. No physical-device call has been tested.

A retry through a temporary short `L:` drive alias hit the same CMake helper launch failure because Gradle resolved the long dependency paths. The alias was removed. Do not treat this as an APK pass or a LiveKit-specific compilation failure; use a genuinely short checkout or clean native CI environment for the next build attempt.

Hard gate: do not merge, deploy or distribute this native trial until Android and iOS development binaries build and real-device teacher/student calls pass, including permissions, speaker/audio route, reconnection, long calls, whiteboard, chat and screen sharing. Phone-browser tests do not satisfy the installed-app gate.

This isolated branch starts from `codex/support-case-workspace`. The current public web build uses LiveKit when configured, while installed iOS/Android builds use Daily. A phone browser is web; it is not evidence that an installed app works.

Release conditions for changing that routing:

1. Replace the native Daily WebRTC fork with LiveKit's React Native SDK in a new native build. Keep the web LiveKit component unchanged.
2. Prove Android and iOS native bundling, Android prebuild/compile, and physical-device camera, microphone, speaker, reconnection, permission and whiteboard behavior. Expo Go cannot exercise this SDK.
3. Introduce a server compatibility signal so old Daily-native builds keep getting Daily and new LiveKit-native builds receive LiveKit. That signal conveys no access rights; membership remains server-side.
4. Do not enable permanent account closure until old Daily access has expired or a reliable revocation path covers it, and until LiveKit provider disconnect is verified on installed apps.
5. Do not require an installed app for phone-browser users until both store apps are available, links and sign-in recovery are tested, and laptop web remains fully usable.

Official SDK setup: https://docs.livekit.io/transport/sdk-platforms/expo/

The first safe server slice is implemented on this trial branch: `X-Fadko-Native-Media: livekit-native-v1` is parsed strictly and passed into both room join and teacher-start provider selection. A missing/invalid capability keeps Daily. Even a valid capability still keeps Daily until the native LiveKit provider is explicitly marked as supporting iOS/Android. No released app sends this header, and no deployed configuration changed.
