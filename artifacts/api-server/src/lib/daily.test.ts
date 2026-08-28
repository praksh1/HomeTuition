/**
 * What a room that already exists is checked for.
 *
 * `ensureDailyRoom` needs an API key and a network, so it cannot be tested here — but the one
 * decision inside it that was wrong can be. A room is created once and reused for the rest of
 * its life, so its settings freeze at whatever they were the day it was made, and every change
 * to the wanted list reached new rooms only. Turning Daily's chat on left every room already in
 * existence without a chat panel; a teacher in one of those was told the feature was live while
 * their call plainly had none. Reported exactly that way.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ROOM_PROPERTIES, propertiesToRepair } from "./dailyRoom.ts";

test("a room with everything already set needs no repair", () => {
  assert.deepEqual(propertiesToRepair({ ...ROOM_PROPERTIES }), {});
});

test("extra settings we do not care about are left alone", () => {
  // Daily returns a room's whole config, most of which is not ours to have an opinion about.
  const config = { ...ROOM_PROPERTIES, exp: 1787000000, max_participants: 50, lang: "en" };
  assert.deepEqual(propertiesToRepair(config), {});
});

test("Daily chat cannot split the class into a second conversation", () => {
  const repairs = propertiesToRepair({ ...ROOM_PROPERTIES, enable_chat: true });
  assert.deepEqual(repairs, { enable_chat: false });
});

test("Daily cannot create a second PIP inside the classroom PIP", () => {
  const repairs = propertiesToRepair({ ...ROOM_PROPERTIES, enable_pip_ui: true });
  assert.deepEqual(repairs, { enable_pip_ui: false });
});

test("a setting simply absent is Daily's default, not ours", () => {
  const { enable_screenshare: _omitted, ...withoutScreenshare } = ROOM_PROPERTIES;
  assert.deepEqual(propertiesToRepair(withoutScreenshare), { enable_screenshare: true });
});

test("a room from before any of this gets the lot", () => {
  assert.deepEqual(propertiesToRepair({}), { ...ROOM_PROPERTIES });
  assert.deepEqual(propertiesToRepair(undefined), { ...ROOM_PROPERTIES });
  assert.deepEqual(propertiesToRepair(null), { ...ROOM_PROPERTIES });
});

test("a setting we deliberately want off is repaired when it is on", () => {
  // start_video_off is false on purpose: a class where everyone starts muted and dark is a
  // class that spends its first minute saying "can you hear me".
  const repairs = propertiesToRepair({ ...ROOM_PROPERTIES, start_video_off: true });
  assert.deepEqual(repairs, { start_video_off: false });
});

test("several wrong at once are all reported, so one round trip fixes the room", () => {
  const repairs = propertiesToRepair({
    ...ROOM_PROPERTIES,
    enable_chat: true,
    enable_pip_ui: true,
    enable_hand_raising: false,
    enable_screenshare: false,
  });
  assert.deepEqual(repairs, {
    enable_chat: false,
    enable_pip_ui: false,
    enable_hand_raising: true,
    enable_screenshare: true,
  });
});
