import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const native = readFileSync(path.join(here, "DailyEmbed.tsx"), "utf8");
const web = readFileSync(path.join(here, "DailyEmbed.web.tsx"), "utf8");

function ordered(source: string, fragments: string[]): boolean {
  let cursor = -1;
  for (const fragment of fragments) {
    cursor = source.indexOf(fragment, cursor + 1);
    if (cursor < 0) return false;
  }
  return true;
}

test("native keeps the Daily join, media controls, callbacks, and device-release order", () => {
  assert.ok(
    ordered(native, [
      "await ensureAndroidPermissions()",
      "Daily.createCallObject()",
      'call.on("joined-meeting"',
      'call.on("participant-left"',
      "watchedParticipantLeft(watched, ev?.participant?.user_name)",
      "cb?.()",
      'call.on("left-meeting"',
      "if (cancelled || leftAnnounced.current) return",
      "leftAnnounced.current = true",
      "cbRef.current.onLeft?.()",
      "await call.join({ url: roomUrl, userName: displayName, ...(meetingToken ? { token: meetingToken } : null) })",
    ]),
    "permission, event, callback, and authenticated join order changed",
  );
  for (const call of [
    "c.setLocalAudio(next)",
    "c.setLocalVideo(next)",
    "c.startScreenShare()",
    "c.stopScreenShare()",
  ]) {
    assert.ok(native.includes(call), `${call} was removed from the native control`);
  }
  assert.match(native, /const presenter = sharingPresenter\(participants\)/);
  assert.match(native, /const stageRemote = firstRemoteParticipant\(participants\)/);
  assert.match(native, /videoTrack=\{trackOf\(stageRemote, "video"\)\}/);
  assert.match(native, /audioTrack=\{trackOf\(stageRemote, "audio"\)\}/);
  const controls = native.slice(native.indexOf("<View style={s.bar}>"));
  for (const handler of ["toggleMic", "toggleCam", "toggleScreenShare", "leave"]) {
    assert.ok(controls.includes(`onPress={${handler}}`), `${handler} is not reachable from the control row`);
  }
  assert.ok(
    native.indexOf("<View style={s.bar}>") > native.indexOf('testID="call-chat-panel"'),
    "the media controls must remain a sibling after the chat overlay, not be trapped inside it",
  );
  assert.ok(
    ordered(native, ["c.leave()", ".finally(() => {", "c.destroy().catch"]),
    "native cleanup must leave before destroying so camera and microphone are released",
  );
});

test("web keeps one Prebuilt frame, one app chat, authenticated join, and guarded leave", () => {
  assert.ok(web.includes("showLeaveButton: false"), "the duplicate provider leave control returned");
  assert.ok(web.includes("showFullscreenButton: false"), "the duplicate provider pop-out control returned");
  assert.ok(
    web.includes('iframe.allow = "camera; microphone; autoplay; display-capture"'),
    "camera, microphone, autoplay, or screen-share permission was dropped",
  );
  assert.ok(
    ordered(web, [
      'callFrame.on("left-meeting"',
      "if (!joined.current) return",
      "joined.current = false",
      "cbRef.current.onLeft?.()",
    ]),
    "a failed join could again be reported as a real leave",
  );
  assert.ok(
    web.includes("await callFrame.join({ url: roomUrl, userName: displayName, ...(meetingToken ? { token: meetingToken } : null) })"),
    "the room URL, display name, or meeting token no longer reaches Daily",
  );
  assert.ok(
    ordered(web, [".then(() => frame.leave())", ".then(() => frame.destroy())"]),
    "web cleanup must leave before destroying so devices are released",
  );
  assert.ok(web.includes("const IN_CALL_CHAT_ENABLED = false"), "the duplicate in-call chat was enabled");
  assert.doesNotMatch(web, /showChatButton\s*:\s*true/, "Daily's separate chat must stay disabled");
});

test("native status overlays use guaranteed opaque contrast pairs", () => {
  assert.match(
    native,
    /presenterTag:[\s\S]*?backgroundColor: colors\.secondary[\s\S]*?presenterTagText: \{ \.\.\.t\.overline, color: colors\.secondaryForeground \}/,
  );
  assert.match(
    native,
    /btnLeave: \{ backgroundColor: colors\.destructiveSoft, borderWidth: 1, borderColor: colors\.destructive \}/,
  );
  assert.match(native, /name="phone-off" size=\{18\} color=\{colors\.destructive\}/);
  assert.doesNotMatch(native, /presenterTag:[\s\S]*?backgroundColor: colors\.scrim/);
});
