# Two video SDKs cannot live in one phone build

Found 4 September 2026 while building the Stream Video proof of concept on
`claude/stream-video-poc`. It changes what "try another video provider on a phone" costs, so it
is worth knowing before anybody plans that work again — for Stream, and for whoever comes after.

## The fact

Every serious React Native video SDK ships its own **fork of `react-native-webrtc`**, and the
forks are not compatible with each other. Daily brings `@daily-co/react-native-webrtc`; Stream
brings `@stream-io/react-native-webrtc`; LiveKit and 100ms do the same thing with their own.

Measured, by comparing the two packages' file lists directly:

| | Daily 124.0.6-daily.2 | Stream 145.3.1 |
|---|---|---|
| Android native module name | `WebRTCModule` | `WebRTCModule` |
| Java classes with identical fully-qualified names | — | **33** in common |
| iOS/macOS sources with identical names | — | **45** in common |
| Prebuilt WebRTC binary | `org.jitsi:webrtc:124.+` | `io.getstream:stream-video-webrtc-android:145.9.0` |
| CocoaPods pod | `react-native-webrtc` → `JitsiWebRTC ~> 124.0.0` | `stream-react-native-webrtc` → `StreamWebRTC = 145.15.0` |

Gradle refuses duplicate classes on the compile path and React Native cannot register two native
modules under one name. **So this is a build failure, not a runtime surprise** — which is the one
piece of good news: nobody can ship a broken app this way by accident.

## What it means for a provider experiment

The web is fine. A browser already has WebRTC, so any provider's web SDK is ordinary JavaScript
and sits happily beside `@daily-co/daily-js`. **Everything except screen sharing from a phone can
be evaluated in a browser**, including quality from Kathmandu, whether the controls work at phone
width, and how the call feels beside the whiteboard.

A phone test is the expensive one. It needs a **separate build with the incumbent taken out** —
different bundle identifier, installed alongside the real app — and that build cannot run Daily,
so the two cannot be compared side by side on one handset. (Remember the trap in `CLAUDE.md`:
Android treats a different package as a different app, so it installs *beside* rather than over.)

The one capability that actually requires paying that cost, today, is **screen sharing from a
phone**: Daily's native path here is a WebView and a WebView cannot capture a screen, so it is
the single thing a phone test would settle that a browser cannot.

## The consequence for how a proof of concept is built

Write the integration against **your own boundary type**, not against the provider's. On
`claude/stream-video-poc` that is `components/stream/streamBridge.ts`, with the provider's SDK
loaded behind `streamSdk.ts` / `streamSdk.web.ts` — so the whole thing compiles, typechecks and
is tested with fakes while the dependency is not installed at all, and the classroom says *why*
it cannot open a call rather than showing a black rectangle.

That is not a workaround for this one conflict. It is what makes a second migration cheap, and
the reason the seam exists at all is that a second migration is likely.
