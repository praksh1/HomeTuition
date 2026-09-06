import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cameraActionLabel,
  chatActionLabel,
  firstRemoteParticipant,
  microphoneActionLabel,
  sharingPresenter,
  screenShareActionLabel,
  unseenChatCount,
  watchedParticipantLeft,
} from "./dailyEmbedUi.ts";

test("media controls announce the action that will happen next", () => {
  assert.equal(microphoneActionLabel(true), "Mute microphone");
  assert.equal(microphoneActionLabel(false), "Unmute microphone");
  assert.equal(cameraActionLabel(true), "Turn camera off");
  assert.equal(cameraActionLabel(false), "Turn camera on");
  assert.equal(screenShareActionLabel("idle"), "Share screen");
  assert.equal(screenShareActionLabel("starting"), "Starting screen share");
  assert.equal(screenShareActionLabel("sharing"), "Stop sharing screen");
});

test("participant selection keeps the presenter, remote stage, and watched-leave rules exact", () => {
  const local = { local: true, user_name: "Teacher", tracks: {} };
  const firstRemote = { local: false, user_name: "Student A", tracks: {} };
  const presenter = {
    local: false,
    user_name: "Student B",
    tracks: { screenVideo: { state: "playable" } },
  };
  const participants = [local, firstRemote, presenter];

  assert.equal(firstRemoteParticipant(participants), firstRemote, "the first remote stays on the normal stage");
  assert.equal(sharingPresenter(participants), presenter, "a playable screen share takes the stage");
  assert.equal(
    sharingPresenter([{ ...presenter, tracks: { screenVideo: { persistentTrack: {} } } }])?.user_name,
    "Student B",
    "a persistent screen track is also a real presentation",
  );
  assert.equal(sharingPresenter([local, firstRemote]), undefined);
  assert.equal(watchedParticipantLeft("Teacher", "Teacher"), true);
  assert.equal(watchedParticipantLeft("Teacher", "Student A"), false);
  assert.equal(watchedParticipantLeft(undefined, "Teacher"), false);
});

test("chat labels and unread counts stay truthful across open and closed states", () => {
  assert.equal(chatActionLabel(false, 0), "Open class chat");
  assert.equal(chatActionLabel(false, 3), "Open class chat, 3 unread");
  assert.equal(chatActionLabel(true, 3), "Close class chat");
  assert.equal(unseenChatCount(7, 4, false), 3);
  assert.equal(unseenChatCount(7, 4, true), 0);
  assert.equal(unseenChatCount(2, 4, false), 0, "a reset thread must not show a negative badge");
});
