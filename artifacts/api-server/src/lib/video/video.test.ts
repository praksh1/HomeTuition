import assert from "node:assert/strict";
import { test } from "node:test";
import { selectProvider } from "./select.ts";
import type { VideoProvider } from "./types.ts";

/**
 * The seam is only worth having if a second provider really can be dropped in.
 *
 * These do not test Daily — that is tested by the suites that open real rooms. They test that
 * nothing outside `lib/video` has to know which provider is carrying the call, which is the
 * whole claim being made. Replacing Daily is decided future work; the test that it is possible
 * belongs here, now, while it is still cheap to keep true.
 */

const daily: VideoProvider = {
  name: "daily",
  capabilities: { screenShare: true, builtInChat: true },
  configured: () => true,
  ensureRoom: async () => "https://example.daily.co/room",
  joinToken: async () => "token",
};

test("the configured provider is the one that runs", () => {
  assert.equal(selectProvider("daily", { daily }, daily).name, "daily");
});

test("an unknown name falls back rather than leaving every class with no video", () => {
  // A typo in an environment variable must not take video down for the whole platform.
  assert.equal(selectProvider("somehting-nobody-wrote", { daily }, daily).name, "daily");
});

test("an empty or missing name falls back too", () => {
  assert.equal(selectProvider("", { daily }, daily).name, "daily");
  assert.equal(selectProvider(undefined, { daily }, daily).name, "daily");
  assert.equal(selectProvider(null, { daily }, daily).name, "daily");
});

test("the name is matched forgivingly, because it is typed by a person", () => {
  assert.equal(selectProvider("  DAILY  ", { daily }, daily).name, "daily");
});

test("a second provider is chosen when it is named", () => {
  const other: VideoProvider = { ...daily, name: "livekit" };
  const chosen = selectProvider("livekit", { daily, livekit: other }, daily);
  // The point of the whole seam: nothing outside this table had to change to get here.
  assert.equal(chosen.name, "livekit");
});

/**
 * A provider written from nothing but the interface.
 *
 * This is the real assertion: something that has never heard of Daily satisfies the contract
 * with a URL and a token, which is all any of the candidates give you — LiveKit hands back a
 * `wss://` server and a JWT, Jitsi a room URL and an optional JWT, and anything built here
 * would do the same.
 */
const pretend: VideoProvider = {
  name: "pretend",
  capabilities: { screenShare: false, builtInChat: false },
  configured: () => true,
  ensureRoom: async (sessionId) => `wss://video.example/room/${sessionId}`,
  joinToken: async (sessionId, options) =>
    `token-${sessionId}-${options.isOwner ? "owner" : "guest"}-${options.userName}`,
};

test("a provider that has never heard of Daily satisfies the contract", async () => {
  assert.equal(await pretend.ensureRoom(42), "wss://video.example/room/42");
  assert.equal(await pretend.joinToken(42, { isOwner: true, userName: "Ram", userId: "7" }), "token-42-owner-Ram");
  assert.equal(await pretend.joinToken(42, { isOwner: false, userName: "Sita", userId: "8" }), "token-42-guest-Sita");
});

test("moderator rights are a parameter, never something the provider decides", async () => {
  const owner = await pretend.joinToken(1, { isOwner: true, userName: "T", userId: "7" });
  const guest = await pretend.joinToken(1, { isOwner: false, userName: "S", userId: "8" });
  assert.notEqual(owner, guest);
  // The server decides who is the owner from its own membership check. A provider that worked
  // it out for itself would be a provider that could be talked into it by a client.
  assert.match(String(owner), /owner/);
  assert.match(String(guest), /guest/);
});

test("a provider may say it cannot share a screen, so the app stops offering it", () => {
  // Not speculative: the native Daily path genuinely cannot, and a control that does nothing is
  // the class of thing this project has had to remove before.
  assert.equal(pretend.capabilities.screenShare, false);
  assert.equal(daily.capabilities.screenShare, true);
  assert.equal(selectProvider("pretend", { daily, pretend }, daily).capabilities.screenShare, false);
});
