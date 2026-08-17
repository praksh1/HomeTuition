# Unused / scratch screens

Nothing in this folder is part of the app. It is kept outside `app/` on purpose: Expo Router
turns every file under `app/` into a live route and bundles it, and these files break the web
build.

## video-test.tsx

An early experiment at embedding video. It imports `../VideoRoom`, which uses
`@daily-co/react-native-daily-js` — Daily's **native** SDK. That SDK cannot be bundled for web
(it needs `react-native-background-timer`, a native-only peer dependency), so while this file
lived in `app/` the entire web build failed to compile.

The real classroom does not use it. `components/DailyEmbed.tsx` embeds Daily in a `WebView` on
native and an `<iframe>` on web, so the native SDK is never needed.

`VideoRoom.tsx` and `ClassroomDoor.tsx` are still at the package root; this file's relative
imports resolve to them. Delete all three together if you want them gone for good.

## Consequences worth knowing

Because nothing imports Daily's native SDK any more, these dependencies in `package.json` are
now unused: `@daily-co/react-native-daily-js`, `@daily-co/react-native-webrtc`, and the
`@config-plugins/react-native-webrtc` plugin entry in `app.json`. They are harmless, but they
add native build weight and camera/microphone permission prompts that nothing uses. Removing
them is a safe cleanup — do it as its own change so it can be reverted on its own.
