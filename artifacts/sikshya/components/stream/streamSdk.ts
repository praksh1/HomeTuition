import type { StreamSdk } from "./streamBridge";

/**
 * The native adapter — the one file that would import Stream's React Native SDK.
 *
 * It does not, today, and that is a deliberate stop rather than an unfinished edge. Installing
 * `@stream-io/video-react-native-sdk` would put a second WebRTC fork in the app beside Daily's,
 * and the two cannot both exist in one Android or iOS binary:
 *
 * | | Daily | Stream |
 * |---|---|---|
 * | npm package | `@daily-co/react-native-webrtc` 124.0.6 | `@stream-io/react-native-webrtc` 145.3.1 |
 * | Android native module name | `WebRTCModule` | `WebRTCModule` |
 * | Identically-named Java classes | — | **33** shared with Daily's fork |
 * | Identically-named iOS sources | — | **45** shared with Daily's fork |
 * | Prebuilt libwebrtc | `org.jitsi:webrtc:124.+` | `io.getstream:stream-video-webrtc-android:145.9.0` |
 * | CocoaPods pod | `react-native-webrtc` (`JitsiWebRTC ~> 124`) | `stream-react-native-webrtc` (`StreamWebRTC = 145.15.0`) |
 *
 * Counted by comparing the two packages' file lists, not inferred from documentation. Gradle
 * refuses duplicate classes on the compile path and React Native cannot register two native
 * modules under one name, so this is a build failure rather than a subtle bug — which is the
 * good news: nobody can accidentally ship it.
 *
 * **So installing the SDK is a branch-level decision, not a line of code.** STREAM.md sets out
 * the two honest routes (a separate Expo development build with Daily's native SDK swapped out
 * for the experiment, or the web-only path where no native module is involved at all) and what
 * each costs.
 *
 * Until then this returns `ok: false` with a reason the classroom shows to the person. Nothing
 * here pretends. There is no fake call, no simulated participant and no control that appears to
 * work — the same rule the payments and email layers already follow: the mode follows from what
 * is actually installed, and when nothing is, the app says so.
 *
 * ### Turning it on
 *
 * When STREAM.md's setup has been done in a throwaway development build, this whole function
 * becomes the dynamic import and the adapter next to it. Nothing above this file changes.
 */
export async function loadStreamSdk(): Promise<StreamSdk> {
  return {
    ok: false,
    reason:
      "Stream video is not built into this app. The Stream React Native SDK needs its own " +
      "WebRTC library, which cannot be installed alongside Daily's — see STREAM.md. The class " +
      "is running on Daily; nothing here is broken.",
  };
}
