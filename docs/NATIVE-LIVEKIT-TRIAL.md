# Native LiveKit trial (not deployed)

This isolated branch starts from `codex/support-case-workspace`. The current public web build uses LiveKit when configured, while installed iOS/Android builds use Daily. A phone browser is web; it is not evidence that an installed app works.

Release conditions for changing that routing:

1. Replace the native Daily WebRTC fork with LiveKit's React Native SDK in a new native build. Keep the web LiveKit component unchanged.
2. Prove Android and iOS native bundling, Android prebuild/compile, and physical-device camera, microphone, speaker, reconnection, permission and whiteboard behavior. Expo Go cannot exercise this SDK.
3. Introduce a server compatibility signal so old Daily-native builds keep getting Daily and new LiveKit-native builds receive LiveKit. That signal conveys no access rights; membership remains server-side.
4. Do not enable permanent account closure until old Daily access has expired or a reliable revocation path covers it, and until LiveKit provider disconnect is verified on installed apps.
5. Do not require an installed app for phone-browser users until both store apps are available, links and sign-in recovery are tested, and laptop web remains fully usable.

Official SDK setup: https://docs.livekit.io/transport/sdk-platforms/expo/

The first safe server slice is implemented on this trial branch: `X-Fadko-Native-Media: livekit-native-v1` is parsed strictly and passed into both room join and teacher-start provider selection. A missing/invalid capability keeps Daily. Even a valid capability still keeps Daily until the native LiveKit provider is explicitly marked as supporting iOS/Android. No released app sends this header, and no deployed configuration changed.
