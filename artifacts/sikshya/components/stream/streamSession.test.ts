import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CALLING_STATE_JOINED,
  CALLING_STATE_LEFT,
  CALLING_STATE_MIGRATING,
  CALLING_STATE_OFFLINE,
  CALLING_STATE_RECONNECTING,
  CALLING_STATE_RECONNECTING_FAILED,
  RAISED_HAND_REACTION,
  TRACK_AUDIO,
  TRACK_SCREEN_SHARE,
  TRACK_VIDEO,
  createStreamSdkFrom,
  createStreamSession,
  describeStreamError,
  toCallParticipant,
  type StreamCallLike,
  type StreamParticipantLike,
} from "./streamSession.ts";
import { incomingVideoFor } from "../../utils/streamRoom.ts";

/**
 * The Stream integration, driven by a fake Stream.
 *
 * There is no Stream account and there will not be one from a test run, so the call object is a
 * recorder that answers instantly and writes down what it was asked. That is enough to check the
 * things that would otherwise cost a teacher a lesson to discover: that a hidden window really
 * stops the video, that leaving really disconnects, that a mute is a mute and not a removal, and
 * that no secret is anywhere near the client.
 *
 * What it cannot check is that Stream does what its documentation says — that needs credentials,
 * and STREAM.md says exactly where that line is.
 */

interface Recorded {
  calls: string[];
  args: Record<string, unknown[]>;
}

/**
 * A subject that records that it was unsubscribed, so a leak shows up as a failing test.
 *
 * The observables here are the real ones Stream exposes — `state.participants$`,
 * `state.callingState$` and each device manager's `state.hasBrowserPermission$`, all read out
 * of `@stream-io/video-client@1.59.0`'s type definitions. Driving them by hand is what turns
 * "the reducer handles reconnection" into "reconnection reaches the shell".
 */
function fakeSubject<T>(note: (name: string) => void, label: string) {
  let observer: ((value: T) => void) | null = null;
  return {
    source: {
      subscribe: (next: (value: T) => void) => {
        observer = next;
        return { unsubscribe: () => note(`unsubscribe:${label}`) };
      },
    },
    emit: (value: T) => observer?.(value),
  };
}

function fakeCall(overrides: Partial<StreamCallLike> = {}) {
  const rec: Recorded = { calls: [], args: {} };
  const handlers = new Map<string, (payload: any) => void>();

  const note = (name: string, ...args: unknown[]) => {
    rec.calls.push(name);
    rec.args[name] = args;
  };

  const participants = fakeSubject<StreamParticipantLike[]>(note, "participants");
  const callingState = fakeSubject<string>(note, "callingState");
  const cameraPermission = fakeSubject<boolean>(note, "cameraPermission");
  const micPermission = fakeSubject<boolean>(note, "micPermission");

  const call: StreamCallLike = {
    join: async (o) => note("join", o),
    leave: async () => note("leave"),
    camera: {
      enable: async () => note("camera.enable"),
      disable: async () => note("camera.disable"),
      flip: async () => note("camera.flip"),
      state: { hasBrowserPermission$: cameraPermission.source },
    },
    microphone: {
      enable: async () => note("microphone.enable"),
      disable: async () => note("microphone.disable"),
      state: { hasBrowserPermission$: micPermission.source },
    },
    screenShare: {
      enable: async () => note("screenShare.enable"),
      disable: async () => note("screenShare.disable"),
    },
    sendReaction: async (r) => note("sendReaction", r),
    muteUser: async (u, type) => note("muteUser", u, type),
    kickUser: async (r) => note("kickUser", r),
    setPreferredIncomingVideoResolution: (r) => note("setPreferredIncomingVideoResolution", r),
    setIncomingVideoEnabled: (e) => note("setIncomingVideoEnabled", e),
    state: {
      participants$: participants.source,
      callingState$: callingState.source,
    },
    on: (event, handler) => {
      handlers.set(event, handler);
      return () => note(`off:${event}`);
    },
    ...overrides,
  };

  return {
    call,
    rec,
    emitParticipants: participants.emit,
    emitCallingState: callingState.emit,
    emitCameraPermission: cameraPermission.emit,
    emitMicPermission: micPermission.emit,
    emit: (event: string, payload: unknown) => handlers.get(event)?.(payload),
  };
}

function noopEvents() {
  const seen: Record<string, unknown[]> = {};
  const record = (name: string) => (payload?: unknown) => {
    (seen[name] ??= []).push(payload);
  };
  return {
    seen,
    events: {
      onJoined: record("joined"),
      onReconnecting: record("reconnecting"),
      onRejoined: record("rejoined"),
      onLeft: record("left"),
      onError: record("error"),
      onPermissionDenied: (device: string, message: string) => {
        (seen["permissionDenied"] ??= []).push({ device, message });
      },
      onPermissionGranted: record("permissionGranted"),
      onParticipants: record("participants"),
      onReaction: record("reaction"),
      onScreenShare: record("screenShare"),
    },
  };
}

const VideoView = () => null;

function session(overrides: Partial<StreamCallLike> = {}) {
  const fake = fakeCall(overrides);
  const { events, seen } = noopEvents();
  const s = createStreamSession({
    call: fake.call,
    events,
    teacherName: "Ram Prasad",
    VideoView,
  });
  return { ...fake, session: s, seen };
}

test("a participant carries both identifiers, and they are not the same one twice", () => {
  const p = toCallParticipant(
    {
      // Deliberately unlike each other. The defect this replaced put the session id in the one
      // field everything read, so a test with matching values would have passed either way.
      userId: "user-11",
      sessionId: "sess-AAAA",
      name: "Ram Prasad",
      publishedTracks: [TRACK_AUDIO, TRACK_VIDEO],
    },
    "Ram Prasad",
  );
  assert.deepEqual(p, {
    userId: "user-11",
    sessionId: "sess-AAAA",
    name: "Ram Prasad",
    isLocal: false,
    isTeacher: true,
    micOn: true,
    camOn: true,
    handRaised: false,
    sharingScreen: false,
  });
});

test("published tracks decide what the tile shows, and the numbers are Stream's own", () => {
  // TRACK_TYPE_AUDIO = 1, VIDEO = 2, SCREEN_SHARE = 3, read off the SFU model enum rather than
  // guessed. A rename that changed them would be silent otherwise.
  assert.equal(TRACK_AUDIO, 1);
  assert.equal(TRACK_VIDEO, 2);
  assert.equal(TRACK_SCREEN_SHARE, 3);

  const muted = toCallParticipant({ userId: "user-2", sessionId: "sess-B", publishedTracks: [] });
  assert.equal(muted.micOn, false);
  assert.equal(muted.camOn, false);

  const presenting = toCallParticipant({
    userId: "user-3",
    sessionId: "sess-C",
    publishedTracks: [TRACK_SCREEN_SHARE],
  });
  assert.equal(presenting.sharingScreen, true);
});

test("only the person the server named is marked the teacher", () => {
  // Not read from the participant's own claim about themselves. The server said, in the room
  // grant, and that is the only thing consulted.
  const at = (name: string, teacher?: string) =>
    toCallParticipant({ userId: "user-1", sessionId: "sess-D", name }, teacher).isTeacher;
  assert.equal(at("Sita", "Ram"), false);
  assert.equal(at("Ram", "Ram"), true);
  // With nobody named, nobody is the teacher — rather than everybody.
  assert.equal(at("Ram"), false);
});

test("a raised hand shows on the person, not as a passing reaction", () => {
  const p = toCallParticipant({
    userId: "user-4",
    sessionId: "sess-E",
    reaction: { type: RAISED_HAND_REACTION },
  });
  assert.equal(p.handRaised, true);
});

test("the participant list reaches the shell as it changes", () => {
  const s = session();
  s.emitParticipants([
    { userId: "user-1", sessionId: "sess-a", name: "Ram Prasad", publishedTracks: [TRACK_AUDIO] },
    { userId: "user-2", sessionId: "sess-b", name: "Sita", isLocalParticipant: true },
  ]);
  const delivered = s.seen.participants?.[0] as any[];
  assert.equal(delivered.length, 2);
  assert.equal(delivered[0].isTeacher, true);
  assert.equal(delivered[0].userId, "user-1");
  assert.equal(delivered[0].sessionId, "sess-a");
  assert.equal(delivered[1].isLocal, true);
});

test("a hidden window unsubscribes from video and asks for no resolution", () => {
  const s = session();
  s.session.setIncomingVideo(incomingVideoFor("hidden"));
  assert.deepEqual(s.rec.args["setIncomingVideoEnabled"], [false]);
  // And it does not then ask for a size, which would switch it straight back on.
  assert.ok(!s.rec.calls.includes("setPreferredIncomingVideoResolution"));
});

test("a visible window asks for a size that matches it", () => {
  const s = session();
  s.session.setIncomingVideo(incomingVideoFor("compact"));
  assert.deepEqual(s.rec.args["setIncomingVideoEnabled"], [true]);
  assert.deepEqual(s.rec.args["setPreferredIncomingVideoResolution"], [
    { width: 320, height: 180 },
  ]);
});

test("resizing the window never rejoins the call", () => {
  const s = session();
  for (const state of ["compact", "normal", "full", "hidden", "normal"] as const) {
    s.session.setIncomingVideo(incomingVideoFor(state));
  }
  // The whole "does not remount when resized" requirement, seen from underneath: five window
  // changes and not one join, leave or teardown.
  assert.ok(!s.rec.calls.includes("join"));
  assert.ok(!s.rec.calls.includes("leave"));
  assert.ok(!s.rec.calls.includes("unsubscribe"));
});

test("the microphone and camera are asked for by name", async () => {
  const s = session();
  await s.session.setMicrophone(false);
  await s.session.setCamera(true);
  assert.ok(s.rec.calls.includes("microphone.disable"));
  assert.ok(s.rec.calls.includes("camera.enable"));
});

test("a raised hand is a reaction of its own type, and lowering says so", async () => {
  const s = session();
  await s.session.raiseHand(true);
  assert.deepEqual(s.rec.args["sendReaction"]?.[0], {
    type: "raised-hand",
    emoji_code: ":raised-hand:",
    custom: { raised: true },
  });
  await s.session.raiseHand(false);
  assert.deepEqual((s.rec.args["sendReaction"]?.[0] as any).custom, { raised: false });
});

test("moderation is addressed to the person, never to the connection", async () => {
  /**
   * The defect this replaced, and the reason both fixtures below use obviously different
   * strings. `toCallParticipant` used to put the **session** id into the single `id` field the
   * shell read, and the shell handed that to `muteUser` and `kickUser` — both of which take a
   * user id. Stream would have matched nobody and returned no error: a teacher presses Mute,
   * sees no complaint, and watches the student keep talking.
   */
  const s = session();
  const person = toCallParticipant(
    { userId: "user-9", sessionId: "sess-ZZZ", name: "Noisy" },
    "Ram Prasad",
  );

  await s.session.muteParticipant(person.userId);
  await s.session.removeParticipant(person.userId);

  assert.deepEqual(s.rec.args["muteUser"], ["user-9", "audio"]);
  assert.deepEqual(s.rec.args["kickUser"], [{ user_id: "user-9", block: false }]);
  // And emphatically not the session id, which is what the old code would have sent.
  assert.ok(!JSON.stringify(s.rec.args["muteUser"]).includes("sess-ZZZ"));
  assert.ok(!JSON.stringify(s.rec.args["kickUser"]).includes("sess-ZZZ"));
});

test("muting somebody touches their microphone and nothing else", async () => {
  const s = session();
  await s.session.muteParticipant("user-9");
  assert.deepEqual(s.rec.args["muteUser"], ["user-9", "audio"]);
  // Not their camera as well. A control that does more than its label is how trust in one goes.
  assert.ok(!s.rec.calls.some((c) => c.includes("camera")));
});

test("removing somebody does not lock them out", async () => {
  const s = session();
  await s.session.removeParticipant("user-9");
  // A student removed from a class they paid for must be able to come back. Whether they should
  // is a refund question, not one for a button in a video window.
  assert.deepEqual(s.rec.args["kickUser"], [{ user_id: "user-9", block: false }]);
});

test("the adapter cannot end the class, because ending it is not the provider's job", () => {
  /**
   * `endCall()` is deliberately absent from both the session this adapter returns and the call
   * shape it is written against. Ending a class means a completed status, a cancelled reminder
   * and a closed attendance record — all Sikshya's — and the teacher's own End Session button
   * already asks before doing any of it. A provider-side end would have stopped the video while
   * the application went on believing the lesson was running.
   */
  const s = session();
  assert.equal("endForEveryone" in s.session, false);
  assert.equal("endCall" in s.call, false);
});

test("leaving detaches every observable it attached", async () => {
  const s = session();
  await s.session.leave();
  // Four subscriptions now, not one: participants, calling state, and each device's permission.
  // A missed unsubscribe here is a call that goes on writing into a shell nobody is looking at.
  for (const label of [
    "unsubscribe:participants",
    "unsubscribe:callingState",
    "unsubscribe:cameraPermission",
    "unsubscribe:micPermission",
  ]) {
    assert.ok(s.rec.calls.includes(label), label);
  }
  assert.ok(s.rec.calls.includes("leave"));
});

/* ---------------------------------------------------------------------------
 * Reconnection and permission, travelling from the call to the shell.
 *
 * These are the tests the first version of this branch did not have. The reducer knew what to do
 * with `onReconnecting`, `onRejoined` and `onPermissionDenied`, and the adapter never emitted any
 * of them — so a call that dropped would have sat there looking connected. Reducer-only tests
 * cannot catch that; only driving the real observables can.
 * ------------------------------------------------------------------------- */

test("the calling states are the strings Stream actually emits", () => {
  // Copied from `CallingState` in @stream-io/video-client@1.59.0 rather than imported, since the
  // SDK is not installed. Pinned here so a drift is a failing test, not a call that quietly
  // stops reporting that it dropped.
  assert.equal(CALLING_STATE_JOINED, "joined");
  assert.equal(CALLING_STATE_RECONNECTING, "reconnecting");
  assert.equal(CALLING_STATE_MIGRATING, "migrating");
  assert.equal(CALLING_STATE_RECONNECTING_FAILED, "reconnecting-failed");
  assert.equal(CALLING_STATE_OFFLINE, "offline");
  assert.equal(CALLING_STATE_LEFT, "left");
});

test("a dropped connection reaches the shell as reconnecting", () => {
  const s = session();
  s.emitCallingState(CALLING_STATE_RECONNECTING);
  assert.equal(s.seen.reconnecting?.length, 1);
  assert.equal(s.seen.rejoined, undefined);
});

test("a server migration counts as reconnecting, because it looks like one", () => {
  // From a student's chair the picture stops and comes back. Calling it something else would
  // mean showing them nothing while it happened.
  const s = session();
  s.emitCallingState(CALLING_STATE_MIGRATING);
  assert.equal(s.seen.reconnecting?.length, 1);
});

test("coming back reaches the shell as rejoined", () => {
  const s = session();
  s.emitCallingState(CALLING_STATE_RECONNECTING);
  s.emitCallingState(CALLING_STATE_JOINED);
  assert.equal(s.seen.rejoined?.length, 1);
});

test("the first join is not reported as a recovery from nothing", () => {
  // `callingState$` emits `joined` on the way in as well. Announcing a rejoin there would race
  // the join the connect path already reports and read as a wobble that never happened.
  const s = session();
  s.emitCallingState(CALLING_STATE_JOINED);
  assert.equal(s.seen.rejoined, undefined);
});

test("a reconnection that gives up says so rather than spinning forever", () => {
  const s = session();
  s.emitCallingState(CALLING_STATE_RECONNECTING);
  s.emitCallingState(CALLING_STATE_RECONNECTING_FAILED);
  assert.equal(s.seen.error?.length, 1);
  assert.match(String(s.seen.error?.[0]), /could not be recovered/i);
});

test("going offline is told as offline", () => {
  const s = session();
  s.emitCallingState(CALLING_STATE_OFFLINE);
  assert.match(String(s.seen.error?.[0]), /offline/i);
});

test("the call state saying it has left is a departure", () => {
  const s = session();
  s.emitCallingState(CALLING_STATE_LEFT);
  assert.equal(s.seen.left?.length, 1);
});

test("a call that ends is announced once, not twice", () => {
  /**
   * Stream reports the end of a call **both** ways: the `call.ended` event fires *and*
   * `callingState$` moves to `left`. Both used to reach `onLeft` — and in the teacher's
   * classroom `onLeft` marks the session completed and cancels its reminder, so ending a class
   * sent that twice.
   */
  const s = session();
  s.emit("call.ended", {});
  s.emitCallingState(CALLING_STATE_LEFT);
  assert.equal(s.seen.left?.length, 1);
});

test("and once in the other order, too", () => {
  const s = session();
  s.emitCallingState(CALLING_STATE_LEFT);
  s.emit("call.ended", {});
  assert.equal(s.seen.left?.length, 1);
});

test("nothing contradicts a departure after it has happened", () => {
  // A `reconnecting` that lands after the call ended is not a wobble worth showing anybody. The
  // reducer already refuses it; refusing it here as well means the two ends cannot disagree.
  const s = session();
  s.emitCallingState(CALLING_STATE_LEFT);
  s.emitCallingState(CALLING_STATE_RECONNECTING);
  s.emitCallingState(CALLING_STATE_JOINED);
  s.emitCallingState(CALLING_STATE_OFFLINE);
  assert.equal(s.seen.left?.length, 1);
  assert.equal(s.seen.reconnecting, undefined);
  assert.equal(s.seen.rejoined, undefined);
  assert.equal(s.seen.error, undefined);
});

test("a wobble before the end is still reported, and the end still only once", () => {
  const s = session();
  s.emitCallingState(CALLING_STATE_RECONNECTING);
  s.emitCallingState(CALLING_STATE_JOINED);
  s.emitCallingState(CALLING_STATE_LEFT);
  s.emit("call.ended", {});
  assert.equal(s.seen.reconnecting?.length, 1);
  assert.equal(s.seen.rejoined?.length, 1);
  assert.equal(s.seen.left?.length, 1);
});

test("a state this shell does not act on changes nothing", () => {
  const s = session();
  s.emitCallingState("joining");
  s.emitCallingState("idle");
  s.emitCallingState("unknown");
  assert.equal(s.seen.reconnecting, undefined);
  assert.equal(s.seen.error, undefined);
  assert.equal(s.seen.left, undefined);
});

test("a refused camera reaches the shell as the camera, not as both devices", () => {
  const s = session();
  s.emitCameraPermission(false);
  assert.deepEqual(s.seen.permissionDenied, [
    { device: "camera", message: "Your camera is blocked. Everything else works." },
  ]);
  // The microphone was never mentioned, so nothing switches it off.
  assert.equal(
    (s.seen.permissionDenied as any[]).some((d) => d.device === "microphone"),
    false,
  );
});

test("a refused microphone reaches the shell as the microphone", () => {
  const s = session();
  s.emitMicPermission(false);
  assert.deepEqual((s.seen.permissionDenied as any[])[0].device, "microphone");
  assert.match(String((s.seen.permissionDenied as any[])[0].message), /hear, but not speak/i);
});

test("an allowed device is reported as allowed, so a mind changed in settings is noticed", () => {
  const s = session();
  s.emitCameraPermission(false);
  s.emitCameraPermission(true);
  assert.deepEqual(s.seen.permissionGranted, ["camera"]);
});

test("a call whose device managers expose no permission state simply never claims one", () => {
  /**
   * `state` is optional on the shape for a reason: the phone SDK's managers are not guaranteed
   * to expose `hasBrowserPermission$` in every version. A missing observable must mean "this
   * shell never says a device was refused" rather than a crash on connect — the honest failure
   * direction, since the alternative is telling somebody their camera is blocked when nothing
   * said so.
   */
  const bare = fakeCall();
  delete (bare.call.camera as any).state;
  delete (bare.call.microphone as any).state;
  const { events, seen } = noopEvents();
  const built = createStreamSession({ call: bare.call, events, VideoView });
  assert.equal(seen.permissionDenied, undefined);
  assert.equal(seen.permissionGranted, undefined);
  assert.doesNotThrow(() => built.setIncomingVideo(incomingVideoFor("normal")));
});

test("the class being ended reads as a departure, not as an error", () => {
  const s = session();
  s.emit("call.ended", {});
  assert.equal(s.seen.left?.length, 1);
  assert.equal(s.seen.error, undefined);
});

test("a raised hand does not also fly across the screen as a reaction", () => {
  const s = session();
  s.emit("call.reaction_new", {
    reaction: { type: "raised-hand", emoji_code: ":raised-hand:", user: { id: "9" } },
  });
  assert.equal(s.seen.reaction === undefined, true);

  s.emit("call.reaction_new", {
    reaction: { type: "reaction", emoji_code: "👍", user: { id: "user-9", name: "Sita" } },
  });
  assert.equal(s.seen.reaction?.length, 1);
  // The person, by user id, with their name — so the shell can attribute it and so one person
  // tapping repeatedly replaces their own chip rather than filling the row.
  assert.deepEqual(s.seen.reaction?.[0], {
    userId: "user-9",
    name: "Sita",
    emoji: "👍",
  });
});

test("a listener that refuses to detach does not strand the call", async () => {
  const s = session({
    on: () => () => {
      throw new Error("stuck");
    },
  });
  await s.session.leave();
  assert.ok(s.rec.calls.includes("leave"));
});

test("device selection appears only where a platform has it", () => {
  const withoutDevices = session();
  assert.equal(withoutDevices.session.listDevices, undefined);
  // A picker with one entry in it is worse than no picker.

  const fake = fakeCall();
  const withDevices = createStreamSession({
    call: fake.call,
    events: noopEvents().events,
    VideoView,
    listDevices: async () => [{ id: "cam-1", label: "Front" }],
    selectDevice: async () => {},
  });
  assert.equal(typeof withDevices.listDevices, "function");
  assert.equal(typeof withDevices.flipCamera, "function");
});

/* ---------------------------------------------------------------------------
 * Building a client, with a fake Stream module in place of the real SDK.
 * ------------------------------------------------------------------------- */

function fakeWebModule() {
  const built: any[] = [];
  const fake = fakeCall();
  return {
    built,
    fake,
    mod: {
      StreamVideoClient: class {
        constructor(options: any) {
          built.push(options);
        }
        call() {
          return fake.call;
        }
        async disconnectUser() {
          fake.rec.calls.push("disconnectUser");
        }
      },
      ParticipantView: () => null,
    } as any,
  };
}

test("the client is built from exactly what the server sent", async () => {
  const web = fakeWebModule();
  const sdk = createStreamSdkFrom(web.mod, { VideoView });
  assert.equal(sdk.ok, true);
  if (!sdk.ok) return;

  await sdk.connect({
    apiKey: "pubkey123",
    callType: "default",
    callId: "sikshya-42",
    token: "signed.server.token",
    userId: "17",
    userName: "Sita Sharma",
    events: noopEvents().events,
  });

  assert.deepEqual(web.built[0], {
    apiKey: "pubkey123",
    user: { id: "17", name: "Sita Sharma" },
    token: "signed.server.token",
  });
  // Nothing else. In particular there is no secret to pass, because the client never had one:
  // the API key is Stream's publishable half and the token was minted on the server.
  assert.deepEqual(Object.keys(web.built[0]).sort(), ["apiKey", "token", "user"]);
});

test("the client never creates a call, it joins the one the server made", async () => {
  const web = fakeWebModule();
  const sdk = createStreamSdkFrom(web.mod, { VideoView });
  if (!sdk.ok) return assert.fail("expected the fake module to be usable");

  await sdk.connect({
    apiKey: "k",
    callType: "default",
    callId: "sikshya-42",
    token: "t",
    userId: "1",
    userName: "T",
    events: noopEvents().events,
  });
  // A client that could create a call would be a client that could open one for a class nobody
  // booked — and the room route is the only place membership is checked.
  assert.deepEqual(web.fake.rec.args["join"], [{ create: false }]);
});

test("leaving closes the socket as well as the call", async () => {
  const web = fakeWebModule();
  const sdk = createStreamSdkFrom(web.mod, { VideoView });
  if (!sdk.ok) return assert.fail("expected the fake module to be usable");

  const s = await sdk.connect({
    apiKey: "k",
    callType: "default",
    callId: "sikshya-42",
    token: "t",
    userId: "1",
    userName: "T",
    events: noopEvents().events,
  });
  await s.leave();
  // A student who closed the classroom but kept a socket open would go on counting as present,
  // which is the attendance record this project's refunds rest on.
  assert.ok(web.fake.rec.calls.includes("leave"));
  assert.ok(web.fake.rec.calls.includes("disconnectUser"));
});

test("a join that fails says why, in words", async () => {
  const web = fakeWebModule();
  web.fake.call.join = async () => {
    throw { errorMsg: "token expired" };
  };
  const sdk = createStreamSdkFrom(web.mod, { VideoView });
  if (!sdk.ok) return assert.fail("expected the fake module to be usable");

  const { events, seen } = noopEvents();
  await assert.rejects(() =>
    sdk.connect({
      apiKey: "k",
      callType: "default",
      callId: "sikshya-42",
      token: "t",
      userId: "1",
      userName: "T",
      events,
    }),
  );
  assert.deepEqual(seen.error, ["token expired"]);
});

test("an error that is not an Error still reads as English", () => {
  // Stream rejects with plain objects as often as with Errors. "[object Object]" helps nobody,
  // and this is the same trap the Daily web path already documents.
  assert.equal(describeStreamError(new Error("boom")), "boom");
  assert.equal(describeStreamError("boom"), "boom");
  assert.equal(describeStreamError({ errorMsg: "boom" }), "boom");
  assert.equal(describeStreamError({ message: "boom" }), "boom");
  assert.equal(describeStreamError({}), "The video call could not be started.");
  assert.equal(describeStreamError(null), "The video call could not be started.");
});
