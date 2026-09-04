import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STREAM_DEFAULT_CALL_TYPE,
  STREAM_ROOM_URI_PREFIX,
  STREAM_STUDENT_ROLE,
  STREAM_TEACHER_ROLE,
  STREAM_TOKEN_MAX_TTL_SECONDS,
  STREAM_TOKEN_MIN_TTL_SECONDS,
  buildStreamRoomUri,
  parseStreamRoomUri,
  redactStreamKey,
  streamCallCid,
  streamCallId,
  streamCallSettings,
  streamConfigProblem,
  streamCreateCallBody,
  streamTokenClaims,
  streamTokenTtlSeconds,
} from "./streamCall.ts";

/**
 * Everything about Stream that can be checked without an account.
 *
 * Which is more than it sounds like. The decisions that would actually cost this product money
 * or leak somebody's class — how long a token lives, which single call it opens, what resolution
 * a lesson is created at, whether a key can reach a log — are all arithmetic on strings, and
 * none of them needs a network. **No test in this file talks to Stream.** There is no Stream
 * account yet and there is not going to be one from CI.
 */

test("a locator says where to join and carries the publishable key, not the secret", () => {
  const uri = buildStreamRoomUri({ apiKey: "pubkey123", callType: "default", callId: "sikshya-42" });
  assert.equal(uri, "stream:call/default/sikshya-42?api_key=pubkey123");
  // It must not look like a link. Somebody will paste it into a browser otherwise, get nothing,
  // and file a bug about the video being down.
  assert.ok(!uri.startsWith("http"));
});

test("a locator reads back as the three things the client needs", () => {
  const parsed = parseStreamRoomUri("stream:call/default/sikshya-42?api_key=pubkey123");
  assert.deepEqual(parsed, { callType: "default", callId: "sikshya-42", apiKey: "pubkey123" });
});

test("a locator round-trips whatever is put in it", () => {
  const original = { apiKey: "k-e_y", callType: "livestream", callId: "sikshya-9001" };
  assert.deepEqual(parseStreamRoomUri(buildStreamRoomUri(original)), {
    callType: "livestream",
    callId: "sikshya-9001",
    apiKey: "k-e_y",
  });
});

test("anything that is not a Stream locator parses as nothing, rather than as half of one", () => {
  // A half-read locator is worse than none: the client would join *something*, with the wrong
  // key or the wrong call, and the failure would surface as an authentication error.
  for (const bad of [
    "",
    null,
    undefined,
    "https://sikshya.daily.co/room",
    "stream:call/default/sikshya-42", // no key
    "stream:call/default?api_key=k", // no id
    "stream:call/a/b/c?api_key=k", // too many parts
    "stream:call/default/sikshya-42?api_key=", // empty key
    // `decodeURIComponent` throws on these rather than returning anything, which is how a
    // documented "returns null" quietly became an exception thrown out of the room route.
    "stream:call/default/sikshya-42?api_key=%zz",
    "stream:call/default/sikshya-42?api_key=%",
    "stream:call/%E0%A4/sikshya-42?api_key=k",
    "stream:call/default/%?api_key=k",
  ]) {
    assert.equal(parseStreamRoomUri(bad as string), null, JSON.stringify(bad));
  }
});

test("the call id is derived from the session and safe to put in a URL", () => {
  assert.equal(streamCallId(42), "sikshya-42");
  assert.equal(streamCallId("42"), "sikshya-42");
  // Same defence the Daily path has in sanitizeRoomName: nothing exotic reaches the provider.
  assert.equal(streamCallId("4 2/../3"), "sikshya-423");
});

test("a token opens exactly one call", () => {
  const claims = streamTokenClaims({
    userId: "17",
    callCid: streamCallCid(STREAM_DEFAULT_CALL_TYPE, streamCallId(42)),
    isOwner: false,
    nowSeconds: 1_000_000,
    ttlSeconds: streamTokenTtlSeconds(60),
  });
  assert.deepEqual(claims.call_cids, ["default:sikshya-42"]);
  // The bug this prevents: without call_cids a Stream token is a key to every call in the app,
  // so a student who booked one class would hold a credential for every other lesson on the
  // platform. That is the same door lib/membership.ts already closed one layer up.
  assert.equal(claims.call_cids.length, 1);
});

test("only the teacher's token asks for the moderator role", () => {
  const now = 1_000_000;
  const cid = "default:sikshya-42";
  const ttlSeconds = streamTokenTtlSeconds(60);
  const teacher = streamTokenClaims({ userId: "1", callCid: cid, isOwner: true, nowSeconds: now, ttlSeconds });
  const student = streamTokenClaims({ userId: "2", callCid: cid, isOwner: false, nowSeconds: now, ttlSeconds });
  assert.equal(teacher.role, STREAM_TEACHER_ROLE);
  assert.equal(student.role, STREAM_STUDENT_ROLE);
  assert.notEqual(teacher.role, student.role);
});

test("a token outlives the class it is for, by exactly the class's own grace", () => {
  /**
   * The defect this replaced would have failed in front of a teacher. The lifetime was a flat
   * hour while the monthly tier is a **ninety-minute** lesson, and Stream's client reconnects
   * with the token it already holds — so a class would have dropped somebody at the hour mark
   * and refused to let them back in, on exactly the connections where reconnecting is normal.
   *
   * Ten minutes for the doors opening early, the booked length, ten for the teacher's overtime.
   * Those two tens are imported from `sessionStart.ts`, so they cannot drift from the clock the
   * rest of the class runs on.
   */
  assert.equal(streamTokenTtlSeconds(90), (10 + 90 + 10) * 60);
  assert.equal(streamTokenTtlSeconds(120), (10 + 120 + 10) * 60);
});

test("a ninety-minute class can still reconnect at the last moment its door is open", () => {
  /**
   * The requirement rather than the arithmetic.
   *
   * Mint a token at the **earliest** moment one can exist — doors open ten minutes before the
   * booked start — and ask whether it is still valid at the **latest** moment `canStart` will let
   * the teacher back in, which is ten minutes past the booked finish. If it is not, a lesson that
   * drops at minute 89 cannot be rejoined, and Stream reconnects with the token it already holds.
   */
  const bookedStart = 1_700_000_000;
  const durationMinutes = 90;
  const mintedAt = bookedStart - 10 * 60; // doors open
  const lastRecoveryMoment = bookedStart + (durationMinutes + 10) * 60; // teacher's cutoff

  const claims = streamTokenClaims({
    userId: "1",
    callCid: "default:sikshya-1",
    isOwner: true,
    nowSeconds: mintedAt,
    ttlSeconds: streamTokenTtlSeconds(durationMinutes),
  });

  assert.ok(
    claims.exp >= lastRecoveryMoment,
    `token expires ${lastRecoveryMoment - claims.exp}s before the door does`,
  );
  // And not wildly beyond it: the whole point of a per-class lifetime is that it is not open-ended.
  assert.ok(claims.exp - lastRecoveryMoment < 60);
});

test("a short class still gets a token long enough to rejoin with", () => {
  // A fifteen-minute class would otherwise mint a thirty-five-minute token, which is fine until
  // somebody's bus goes through a tunnel.
  assert.equal(streamTokenTtlSeconds(15), STREAM_TOKEN_MIN_TTL_SECONDS);
  assert.equal(STREAM_TOKEN_MIN_TTL_SECONDS, 3600);
});

test("an absurd class cannot mint an absurd token", () => {
  // `duration` is validated as "a positive integer" and nothing more, so a typo of 100000 must
  // not produce a credential that lives ten weeks.
  assert.equal(streamTokenTtlSeconds(100_000), STREAM_TOKEN_MAX_TTL_SECONDS);
  assert.equal(STREAM_TOKEN_MAX_TTL_SECONDS, 6 * 3600);
  // Still a fraction of the eight hours the Daily path mints, and still bound to one call.
  assert.ok(STREAM_TOKEN_MAX_TTL_SECONDS < 8 * 3600);
});

test("nonsense durations fall back to the floor rather than to a negative lifetime", () => {
  for (const bad of [0, -5, Number.NaN]) {
    assert.equal(streamTokenTtlSeconds(bad as number), STREAM_TOKEN_MIN_TTL_SECONDS, String(bad));
  }
});

test("the expiry is measured from the moment the token was minted", () => {
  const claims = streamTokenClaims({
    userId: "1",
    callCid: "default:sikshya-1",
    isOwner: true,
    nowSeconds: 1_000_000,
    ttlSeconds: streamTokenTtlSeconds(90),
  });
  assert.equal(claims.iat, 1_000_000);
  assert.equal(claims.exp, 1_000_000 + (10 + 90 + 10) * 60);
});

test("a class is created at the resolution the pricing model is built on", () => {
  const settings = streamCallSettings() as Record<string, any>;
  // Stream bills by the resolution a participant *receives*. 720p is roughly twice 480p, and on
  // the monthly tier that is the difference between a subscription that works and one that does
  // not — see .agents/backlog/video-provider-research-2026-08-28.md.
  assert.deepEqual(settings.video.target_resolution, {
    width: 640,
    height: 480,
    bitrate: 600_000,
  });
});

test("cameras are off by default and microphones are not", () => {
  const settings = streamCallSettings() as Record<string, any>;
  // Audio is the lesson; video is the courtesy. Forty-five cameras coming up unasked is
  // forty-five upstreams on connections that cannot carry them.
  assert.equal(settings.video.camera_default_on, false);
  assert.equal(settings.audio.mic_default_on, true);
  assert.equal(settings.audio.opus_dtx_enabled, true);
});

test("nothing that costs money is switched on by accident", () => {
  const settings = streamCallSettings() as Record<string, any>;
  assert.equal(settings.recording.mode, "disabled");
  assert.equal(settings.transcription.mode, "disabled");
  assert.equal(settings.transcription.closed_caption_mode, "disabled");
});

test("students cannot ask to present, because nobody is running that queue", () => {
  const settings = streamCallSettings() as Record<string, any>;
  assert.equal(settings.screensharing.enabled, true);
  assert.equal(settings.screensharing.access_request_enabled, false);
});

test("the room belongs to the platform, not to whoever opened it first", () => {
  const body = streamCreateCallBody() as Record<string, any>;
  assert.equal(body.data.created_by.id, "sikshya-system");
  // Rights come from the role claim and from nothing else. Naming a person as the creator would
  // give one participant a standing that did not come from this server's membership check.
  assert.ok(!("created_by_id" in body.data));
});

test("with no credentials the log line names which variable is missing", () => {
  assert.match(streamConfigProblem({}) ?? "", /STREAM_API_KEY and STREAM_API_SECRET/);
  assert.match(streamConfigProblem({ STREAM_API_KEY: "k" }) ?? "", /STREAM_API_SECRET is not set/);
  assert.match(streamConfigProblem({ STREAM_API_SECRET: "s" }) ?? "", /STREAM_API_KEY is not set/);
  // Whitespace is not a credential.
  assert.notEqual(streamConfigProblem({ STREAM_API_KEY: "  ", STREAM_API_SECRET: "  " }), null);
});

test("with both credentials there is nothing to complain about", () => {
  assert.equal(streamConfigProblem({ STREAM_API_KEY: "k", STREAM_API_SECRET: "s" }), null);
});

test("a key never reaches a log whole", () => {
  const key = "abcdefghijklmnop";
  const redacted = redactStreamKey(key);
  assert.ok(!redacted.includes(key));
  assert.ok(redacted.startsWith("abcd"));
  assert.equal(redactStreamKey(undefined), "(unset)");
  assert.equal(redactStreamKey("ab"), "****");
});

test("the locator prefix is the contract the app parses against", () => {
  // Pinned as a literal here and as a literal in the app's own test, so a change to either side
  // fails on both. A locator format that drifts is a class that will not open, on one platform.
  assert.equal(STREAM_ROOM_URI_PREFIX, "stream:call/");
});
