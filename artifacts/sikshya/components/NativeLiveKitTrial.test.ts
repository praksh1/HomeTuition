import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(path.join(here, file), "utf8");
const native = read("LiveKitEmbed.tsx");
const dailyFallback = read("DailyEmbed.tsx");
const manifest = read("../package.json");
const expoConfig = read("../app.json");
const api = read("../utils/api.ts");

test("trial phone has just one native WebRTC SDK", () => {
  assert.doesNotMatch(manifest, /@daily-co\/react-native-(?:daily-js|webrtc)/);
  assert.doesNotMatch(expoConfig, /withDailyAndroid/);
  assert.doesNotMatch(dailyFallback, /@daily-co\/react-native/);
  assert.match(manifest, /@livekit\/react-native-webrtc/);
  assert.match(expoConfig, /@livekit\/react-native-expo-plugin/);
  assert.match(dailyFallback, /daily-unavailable-native-trial/);
  assert.match(api, /process\.env\.EXPO_PUBLIC_NATIVE_LIVEKIT_TRIAL === "1"/);
  assert.match(api, /headers\[NATIVE_MEDIA_CAPABILITY_HEADER\] = "livekit-native-v1"/);
});

test("trial adapter preserves authenticated join, media controls, app chat and classroom callbacks", () => {
  for (const behavior of [
    "registerGlobals()",
    "await AudioSession.startAudioSession()",
    "await room.connect(props.roomUrl, props.meetingToken!)",
    "onMediaReady?.()",
    "onConnectionChange?.(true)",
    "onWatchedParticipantLeft?.()",
    "onWatchedParticipantReturned?.()",
    "onLocalMediaChange?.(",
    "onLeft?.()",
    "micToggleRequest",
    "cameraToggleRequest",
    'testID="call-chat-panel"',
    "AudioSession.stopAudioSession()",
  ]) assert.ok(native.includes(behavior), behavior + " is missing");
});
