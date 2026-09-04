import assert from "node:assert/strict";
import { test } from "node:test";
import {
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

function fakeCall(overrides: Partial<StreamCallLike> = {}) {
  const rec: Recorded = { calls: [], args: {} };
  let participantsObserver: ((p: StreamParticipantLike[]) => void) | null = null;
  const handlers = new Map<string, (payload: any) => void>();

  const note = (name: string, ...args: unknown[]) => {
    rec.calls.push(name);
    rec.args[name] = args;
  };

  const call: StreamCallLike = {
    join: async (o) => note("join", o),
    leave: async () => note("leave"),
    endCall: async () => note("endCall"),
    camera: {
      enable: async () => note("camera.enable"),
      disable: async () => note("camera.disable"),
      flip: async () => note("camera.flip"),
    },
    microphone: {
      enable: async () => note("microphone.enable"),
      disable: async () => note("microphone.disable"),
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
      participants$: {
        subscribe: (observer) => {
          participantsObserver = observer;
          return { unsubscribe: () => note("unsubscribe") };
        },
      },
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
    emitParticipants: (list: StreamParticipantLike[]) => participantsObserver?.(list),
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
      onPermissionDenied: record("permissionDenied"),
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

test("a participant is read into this app's own shape, not Stream's", () => {
  const p = toCallParticipant(
    {
      userId: "11",
      sessionId: "sess-1",
      name: "Ram Prasad",
      publishedTracks: [TRACK_AUDIO, TRACK_VIDEO],
    },
    "Ram Prasad",
  );
  assert.deepEqual(p, {
    id: "sess-1",
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

  const muted = toCallParticipant({ userId: "2", sessionId: "s", publishedTracks: [] });
  assert.equal(muted.micOn, false);
  assert.equal(muted.camOn, false);

  const presenting = toCallParticipant({
    userId: "3",
    sessionId: "s",
    publishedTracks: [TRACK_SCREEN_SHARE],
  });
  assert.equal(presenting.sharingScreen, true);
});

test("only the person the server named is marked the teacher", () => {
  // Not read from the participant's own claim about themselves. The server said, in the room
  // grant, and that is the only thing consulted.
  assert.equal(toCallParticipant({ userId: "1", sessionId: "s", name: "Sita" }, "Ram").isTeacher, false);
  assert.equal(toCallParticipant({ userId: "1", sessionId: "s", name: "Ram" }, "Ram").isTeacher, true);
  // With nobody named, nobody is the teacher — rather than everybody.
  assert.equal(toCallParticipant({ userId: "1", sessionId: "s", name: "Ram" }).isTeacher, false);
});

test("a raised hand shows on the person, not as a passing reaction", () => {
  const p = toCallParticipant({
    userId: "4",
    sessionId: "s",
    reaction: { type: RAISED_HAND_REACTION },
  });
  assert.equal(p.handRaised, true);
});

test("the participant list reaches the shell as it changes", () => {
  const s = session();
  s.emitParticipants([
    { userId: "1", sessionId: "a", name: "Ram Prasad", publishedTracks: [TRACK_AUDIO] },
    { userId: "2", sessionId: "b", name: "Sita", isLocalParticipant: true },
  ]);
  const delivered = s.seen.participants?.[0] as any[];
  assert.equal(delivered.length, 2);
  assert.equal(delivered[0].isTeacher, true);
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

test("muting somebody mutes their microphone and nothing else", async () => {
  const s = session();
  await s.session.muteParticipant("sess-9");
  assert.deepEqual(s.rec.args["muteUser"], ["sess-9", "audio"]);
  // Not their camera as well. A control that does more than its label is how trust in one goes.
  assert.ok(!s.rec.calls.includes("endCall"));
});

test("removing somebody does not lock them out", async () => {
  const s = session();
  await s.session.removeParticipant("sess-9");
  // A student removed from a class they paid for must be able to come back. Whether they should
  // is a refund question, not one for a button in a video window.
  assert.deepEqual(s.rec.args["kickUser"], [{ user_id: "sess-9", block: false }]);
});

test("ending for everyone is a different call from leaving", async () => {
  const s = session();
  await s.session.endForEveryone();
  assert.ok(s.rec.calls.includes("endCall"));
  assert.ok(!s.rec.calls.includes("leave"));
});

test("leaving detaches everything it attached", async () => {
  const s = session();
  await s.session.leave();
  assert.ok(s.rec.calls.includes("unsubscribe"));
  assert.ok(s.rec.calls.includes("leave"));
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
    reaction: { type: "reaction", emoji_code: "👍", user: { id: "9" } },
  });
  assert.equal(s.seen.reaction?.length, 1);
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
