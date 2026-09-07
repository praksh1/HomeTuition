/**
 * Drives the LiveKit call surface in a real browser.
 *
 * ## Why the provider is faked and the component is not
 *
 * `components/LiveKitEmbed.web.tsx` is bundled exactly as it ships. What is replaced is
 * `lib/video` — the module underneath it — with one that hands back a session the test drives
 * from the page. That split is the point: everything this suite asserts is the component's own
 * behaviour, and none of it depends on reaching a LiveKit server.
 *
 * It has to be that way. There is no LiveKit server to reach here, and the states worth
 * checking are precisely the ones that are hard to produce against a real one on demand: a
 * connection dropping, a camera permission refused, a browser holding the sound back, a
 * teacher leaving mid-lesson. A fake provider can be told to do each of those in order.
 *
 * ## What this therefore does not prove
 *
 * That media flows. No camera is opened, no packet is sent, and no token is checked. The
 * server's half is covered by `api-server/scripts/video-tests` — which does mint real tokens
 * and does assert the API secret never leaves the server — and the remaining gap, a genuine
 * two-person call, is a person with credentials and two browsers. VIDEO.md says so plainly
 * rather than letting a green suite imply otherwise.
 *
 * Usage, from artifacts/sikshya:  node scripts/livekit-tests/run.mjs
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { bundleForBrowser } from "../bundle-for-browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");

/** Screenshots land outside the repository, so a test run never dirties the working tree. */
const SHOTS = process.env.LIVEKIT_SHOT_DIR || path.join(tmpdir(), "livekit-shots");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const work = mkdtempSync(path.join(tmpdir(), "livekit-"));
mkdirSync(SHOTS, { recursive: true });

/*
  The stand-in for lib/video.

  It answers the same shape `types.ts` describes and nothing more, so a component that reached
  past the contract — for a LiveKit type, say — would fail to bundle here rather than passing a
  test and breaking in a lesson.
*/
const fakeProvider = path.join(work, "fake-video.js");
writeFileSync(
  fakeProvider,
  `
window.__plans = [];
const connectionListeners = new Set();
const rosterListeners = new Set();
const problemListeners = new Set();

const state = {
  connection: "connecting",
  participants: [],
  audioOnly: false,
  audioBlocked: false,
  screenSharing: false,
};

function handle(id) {
  // A media handle the component can attach and detach without a real track behind it.
  return { id, attach() {}, detach() {} };
}

const session = {
  provider: "livekit",
  get audioOnly() { return state.audioOnly; },
  get audioBlocked() { return state.audioBlocked; },
  async leaveRoom() { push("disconnected"); },
  async toggleMic(on) {
    const me = state.participants.find((p) => p.isLocal);
    if (me) me.micEnabled = on === undefined ? !me.micEnabled : on;
    roster();
    return me ? me.micEnabled : false;
  },
  async toggleCamera(on) {
    if (state.audioOnly) return false;
    const me = state.participants.find((p) => p.isLocal);
    if (me) me.cameraEnabled = on === undefined ? !me.cameraEnabled : on;
    roster();
    return me ? me.cameraEnabled : false;
  },
  async switchCamera() { window.__lkFlipped = (window.__lkFlipped || 0) + 1; return true; },
  async startScreenShare() { state.screenSharing = true; roster(); return true; },
  async stopScreenShare() { state.screenSharing = false; roster(); },
  getParticipants() { return state.participants.map((p) => ({ ...p })); },
  async setAudioOnly(on) {
    state.audioOnly = on;
    for (const p of state.participants) {
      if (p.isLocal) {
        // The sending half: this person's own camera stops.
        if (on) p.cameraEnabled = false;
      } else {
        /*
          The receiving half, and the one that matters on a weak line.

          The real provider unsubscribes from every remote camera, so the track goes away and
          the handle with it. Modelled here because "the faces disappear" is the property being
          asserted, and a fake that kept handing out camera handles would let a version that
          only stopped the local camera pass.
        */
        p.camera = on ? null : handle(p.id + "-cam");
      }
    }
    roster();
  },
  async unblockAudio() { state.audioBlocked = false; roster(); },
  /*
    Recorded rather than performed.

    The real one unsubscribes and asks for a simulcast layer; what is worth asserting here is the
    *decision* — who the component thought was worth paying for — and that is the argument, not
    the effect. Whether unsubscribing actually saves bytes is LiveKit's business.
  */
  setCameraPlan(plan) { window.__plans.push(plan); },
  onConnectionStateChange(fn) { connectionListeners.add(fn); fn(state.connection); return () => connectionListeners.delete(fn); },
  onParticipantsChange(fn) { rosterListeners.add(fn); fn(session.getParticipants()); return () => rosterListeners.delete(fn); },
  onMediaProblem(fn) { problemListeners.add(fn); return () => problemListeners.delete(fn); },
};

function push(next) {
  state.connection = next;
  for (const fn of connectionListeners) fn(next);
}
function roster() {
  for (const fn of rosterListeners) fn(session.getParticipants());
}

export async function joinRoom() { return session; }
export async function leaveRoom() { push("disconnected"); }

// The controls the test pulls, from the page.
window.__lk = {
  connect(people) {
    state.participants = people.map((p) => ({
      id: p.id,
      name: p.name,
      isLocal: Boolean(p.isLocal),
      isSpeaking: Boolean(p.isSpeaking),
      micEnabled: p.micEnabled !== false,
      cameraEnabled: p.cameraEnabled !== false,
      camera: p.cameraEnabled === false ? null : handle(p.id + "-cam"),
      screen: p.screen ? handle(p.id + "-screen") : null,
      microphone: p.isLocal ? null : handle(p.id + "-mic"),
      quality: p.quality || "excellent",
    }));
    push("connected");
    roster();
  },
  drop() { push("reconnecting"); },
  recover() { push("connected"); },
  problem(p) { for (const fn of problemListeners) fn(p); },
  blockAudio() { state.audioBlocked = true; roster(); },
  remove(id) { state.participants = state.participants.filter((p) => p.id !== id); roster(); },
  state: () => ({ ...state }),
};
`,
);

const entry = path.join(work, "entry.jsx");
writeFileSync(
  entry,
  `
import React from "react";
import { createRoot } from "react-dom/client";
import LiveKitEmbed from ${JSON.stringify(path.join(appRoot, "components", "LiveKitEmbed.web.tsx"))};

window.__events = { left: 0, watchedLeft: 0 };

function Harness() {
  return React.createElement("div", { style: { position: "relative", width: "100vw", height: "100vh" } },
    React.createElement(LiveKitEmbed, {
      roomUrl: "wss://example.invalid",
      meetingToken: "test-token",
      displayName: "Sita Sharma",
      canScreenShare: true,
      teacherUserId: "2",
      watchUserName: "Ram Bahadur",
      onLeft: () => { window.__events.left += 1; },
      onWatchedParticipantLeft: () => { window.__events.watchedLeft += 1; },
    }),
  );
}
createRoot(document.getElementById("root")).render(React.createElement(Harness));
`,
);

const bundle = path.join(work, "bundle.js");

// The one substitution: the real component, with the fake provider underneath it.
const { ok: buildOk, error: buildError } = await bundleForBrowser({
  entry,
  outfile: bundle,
  alias: { "@/lib/video": fakeProvider },
});
if (!buildOk) {
  console.error(buildError);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

const page = path.join(work, "index.html");
writeFileSync(
  page,
  `<!doctype html><html><head><meta charset="utf-8"><title>livekit call</title>
<style>body{margin:0}</style></head>
<body><div id="root"></div><script src="bundle.js"></script></body></html>`,
);

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1440, height: 900 };

async function run(chromium, viewport, label) {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`file://${page}`);
  await p.waitForTimeout(600);

  console.log(`\n[${label}] The call surface comes up`);
  check(`${label}: renders without a page error`, errors.length === 0, errors[0] ?? "");
  check(`${label}: the call area is there`, (await p.locator('[data-testid="livekit-embed"]').count()) === 1);

  console.log(`\n[${label}] A class with a teacher and two students`);
  await p.evaluate(() => window.__lk.connect([
    { id: "u1", name: "Sita Sharma", isLocal: true, quality: "excellent" },
    { id: "u2", name: "Ram Bahadur", quality: "good", isSpeaking: true },
    { id: "u3", name: "Gita Thapa", quality: "poor", micEnabled: false, cameraEnabled: false },
  ]));
  await p.waitForTimeout(400);

  check(`${label}: every person has a tile`, (await p.locator('[data-testid^="livekit-tile-"]').count()) === 3);
  check(`${label}: a muted person is labelled muted`, (await p.locator("text=muted").count()) === 1);
  check(`${label}: the local tile says You`, (await p.locator("text=You").count()) === 1);
  check(
    `${label}: a camera-off person shows their initials rather than a black box`,
    (await p.locator('[data-testid="livekit-tile-u3"]').getByText("GT").count()) === 1,
  );

  console.log(`\n[${label}] The tiles fill the panel and the self-view stays inside it`);
  const stage = await p.locator('[data-testid="livekit-grid"]').boundingBox();
  const tiles = await p.locator('[data-testid^="livekit-tile-"]').all();
  const boxes = [];
  for (const tile of tiles) boxes.push(await tile.boundingBox());
  const remoteBoxes = boxes.slice(0, 2);
  const usedHeight = Math.max(...remoteBoxes.map((b) => b.y + b.height)) - Math.min(...remoteBoxes.map((b) => b.y));
  check(
    `${label}: the tiles use the height there is, not a band of it`,
    stage && usedHeight >= stage.height * 0.9,
    stage ? `${Math.round(usedHeight)} of ${Math.round(stage.height)}` : "no stage",
  );

  /*
    The column count is computed from the panel's shape, so it differs by device and that is
    the point: two people in a tall phone panel stack, and in a wide laptop panel sit side by
    side. Asserted by geometry rather than by reading the style, because the style being right
    and the layout being wrong is exactly the failure this replaced.
  */
  const sideBySide = Math.abs(remoteBoxes[0].y - remoteBoxes[1].y) < 4;
  check(
    `${label}: two people are laid out the way this shape of panel wants`,
    label.startsWith("phone") ? !sideBySide : sideBySide,
    sideBySide ? "side by side" : "stacked",
  );

  const insetBox = boxes[2];
  const embed = await p.locator('[data-testid="livekit-embed"]').boundingBox();
  check(
    `${label}: the self-view is fully inside the call panel`,
    insetBox && embed &&
      insetBox.x >= embed.x - 1 &&
      insetBox.y >= embed.y - 1 &&
      insetBox.x + insetBox.width <= embed.x + embed.width + 1 &&
      insetBox.y + insetBox.height <= embed.y + embed.height + 1,
    insetBox ? `${Math.round(insetBox.x)},${Math.round(insetBox.y)} ${Math.round(insetBox.width)}x${Math.round(insetBox.height)}` : "missing",
  );
  check(
    `${label}: and small enough to be a self-view rather than a tile`,
    insetBox && stage && insetBox.width <= stage.width * 0.4,
    insetBox && stage ? `${Math.round(insetBox.width)} of ${Math.round(stage.width)}` : "missing",
  );

  // Every dot is a quality indicator; three people means three of them, each labelled in words
  // as well as colour — a colour alone is unreadable to a colour-blind teacher.
  const qualityLabels = await p.locator('[aria-label^="Connection:"]').allTextContents();
  check(`${label}: connection quality is shown for each person`, qualityLabels.length === 3);
  check(
    `${label}: and the weak connection is named in words, not only in colour`,
    (await p.locator('[aria-label="Connection: weak"]').count()) === 1,
  );

  console.log(`\n[${label}] The controls are reachable`);
  for (const id of ["livekit-mic", "livekit-camera", "livekit-audio-only", "livekit-leave"]) {
    const box = await p.locator(`[data-testid="${id}"]`).boundingBox();
    check(
      `${label}: ${id} is at least 44x44`,
      Boolean(box) && box.width >= 44 && box.height >= 44,
      box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "missing",
    );
  }
  check(
    `${label}: the teacher's screen-share control is offered`,
    (await p.locator('[data-testid="livekit-share"]').count()) === 1,
  );
  // The panel is narrow on a phone; controls must wrap rather than run off the edge.
  const barWidth = (await p.locator('[data-testid="livekit-controls"]').boundingBox())?.width ?? 0;
  check(`${label}: no control is cut off by the panel edge`, barWidth <= viewport.width + 1);

  await p.screenshot({ path: path.join(SHOTS, `${label}-call.png`) });

  console.log(`\n[${label}] Audio-only keeps the lesson and drops the faces`);
  await p.locator('[data-testid="livekit-audio-only"]').click();
  await p.waitForTimeout(300);
  check(
    `${label}: the control flips to offering video back`,
    (await p.locator('[data-testid="livekit-audio-only"]').textContent()) === "Video on",
  );
  check(`${label}: and it turned the local camera off`, await p.evaluate(() => window.__lk.state().audioOnly));
  /*
    The point of the mode: no video is being received either.

    A version that only stopped the local camera would look identical to the person who pressed
    it and would save them almost nothing — receiving other people's cameras is the larger half
    of the traffic. So this counts the video elements actually on the page.
  */
  check(
    `${label}: no video is being received either`,
    (await p.locator("video").count()) === 0,
    `${await p.locator("video").count()} video elements still attached`,
  );
  check(
    `${label}: and the faces are replaced by names, not by blank boxes`,
    (await p.locator('[data-testid="livekit-tile-u2"]').getByText("RB").count()) === 1,
  );
  await p.screenshot({ path: path.join(SHOTS, `${label}-audio-only.png`) });
  await p.locator('[data-testid="livekit-audio-only"]').click();
  await p.waitForTimeout(300);
  check(
    `${label}: turning video back on restores the faces`,
    (await p.locator("video").count()) > 0,
  );

  console.log(`\n[${label}] A connection that drops says so and does not despair`);
  await p.evaluate(() => window.__lk.drop());
  await p.waitForTimeout(300);
  const banner = await p.locator('[data-testid="livekit-banner"]').textContent();
  check(`${label}: it says it is reconnecting`, (banner ?? "").includes("Reconnecting"));
  check(`${label}: and says the board still works`, (banner ?? "").includes("board"));
  check(
    `${label}: and does not report the person as having left`,
    (await p.evaluate(() => window.__events.left)) === 0,
  );
  await p.screenshot({ path: path.join(SHOTS, `${label}-reconnecting.png`) });
  await p.evaluate(() => window.__lk.recover());
  await p.waitForTimeout(300);
  check(`${label}: recovering clears the banner`, (await p.locator('[data-testid="livekit-banner"]').count()) === 0);

  console.log(`\n[${label}] A refused camera is explained, with the way out`);
  await p.evaluate(() => window.__lk.problem({ kind: "camera", reason: "denied" }));
  await p.waitForTimeout(300);
  const denied = (await p.locator('[data-testid="livekit-device-problem"]').textContent()) ?? "";
  check(`${label}: it says the camera is blocked`, denied.includes("blocked"));
  check(`${label}: it names the control to press`, denied.includes("padlock"));
  check(`${label}: and it can be dismissed`, (await p.locator('[data-testid="livekit-dismiss-problem"]').count()) === 1);
  await p.screenshot({ path: path.join(SHOTS, `${label}-camera-denied.png`) });
  await p.locator('[data-testid="livekit-dismiss-problem"]').click();
  await p.waitForTimeout(200);

  console.log(`\n[${label}] A microphone in use reads differently from one that is blocked`);
  await p.evaluate(() => window.__lk.problem({ kind: "microphone", reason: "in-use" }));
  await p.waitForTimeout(300);
  const inUse = (await p.locator('[data-testid="livekit-device-problem"]').textContent()) ?? "";
  check(`${label}: it says another app has the microphone`, inUse.includes("another app"));
  check(`${label}: and does not tell them to change a permission they have`, !inUse.includes("padlock"));
  await p.locator('[data-testid="livekit-dismiss-problem"]').click();
  await p.waitForTimeout(200);

  console.log(`\n[${label}] Sound the browser is holding back has a visible way through`);
  await p.evaluate(() => window.__lk.blockAudio());
  await p.waitForTimeout(300);
  check(`${label}: there is a button to turn the sound on`, (await p.locator('[data-testid="livekit-unblock-audio"]').count()) === 1);
  await p.screenshot({ path: path.join(SHOTS, `${label}-sound-blocked.png`) });
  await p.locator('[data-testid="livekit-unblock-audio"]').click();
  await p.waitForTimeout(300);
  check(`${label}: pressing it clears the prompt`, (await p.locator('[data-testid="livekit-unblock-audio"]').count()) === 0);

  console.log(`\n[${label}] The controls say what they will do, not what they are`);
  /*
    The same wording the Daily embed uses, from the same shared helpers.

    "Mute" alone does not tell somebody using a screen reader whether pressing it mutes them or
    reports that they already are. And a control that speaks one way on Daily and another on
    LiveKit is a difference only that person would ever encounter.
  */
  /*
    Checked against the control's own visible state rather than a fixed string.

    An earlier version pinned the exact words, and went red the moment a test above it turned the
    camera off — the assertion was really about the order of this file, not about the component.
    What matters is that the spoken name says what a press will *do* and agrees with what the
    button shows, whichever way round the control currently is.
  */
  const spoken = {
    "livekit-mic": { Mute: "Mute microphone", Unmute: "Unmute microphone" },
    "livekit-camera": { "Camera off": "Turn camera off", "Camera on": "Turn camera on" },
    "livekit-share": { "Share screen": "Share screen", "Stop sharing": "Stop sharing screen" },
  };
  for (const [id, wording] of Object.entries(spoken)) {
    const control = p.locator(`[data-testid="${id}"]`);
    const seen = (await control.textContent()) ?? "";
    const heard = await control.getAttribute("aria-label");
    check(
      `${label}: ${id} names its action, not its state`,
      heard === wording[seen],
      `shows "${seen}", says "${heard}"`,
    );
  }

  console.log(`\n[${label}] A teacher leaving is reported to the student`);
  await p.evaluate(() => window.__lk.remove("u2"));
  await p.waitForTimeout(300);
  check(
    `${label}: the watched participant leaving fires exactly once`,
    (await p.evaluate(() => window.__events.watchedLeft)) === 1,
  );
  check(`${label}: and their tile is gone`, (await p.locator('[data-testid="livekit-tile-u2"]').count()) === 0);

  console.log(`\n[${label}] Leaving is announced once, not twice`);
  /*
    Pressing Leave disconnects, and disconnecting is itself "this person left" — so the same
    departure arrived down two paths. The classroom acts on `onLeft` by tearing the room down
    and navigating away, so announcing it twice is not a cosmetic duplicate.
  */
  await p.locator('[data-testid="livekit-leave"]').click();
  await p.waitForTimeout(500);
  check(
    `${label}: one press of Leave means one departure`,
    (await p.evaluate(() => window.__events.left)) === 1,
    `fired ${await p.evaluate(() => window.__events.left)} times`,
  );

  console.log(`\n[${label}] Nothing threw along the way`);
  console.log(`\n[${label}] A discussion bigger than the screen`);
  /*
    Twelve people, which is a real monthly class. The point is not the layout — it is that a phone
    does not download eleven cameras to draw four tiles, because that is the number the whole
    Monthly price rests on. See utils/discussionLayout.ts.
  */
  await p.evaluate(() => {
    window.__plans = [];
    window.__lk.connect([
      { id: "1", name: "Sita Sharma", isLocal: true },
      { id: "2", name: "Teacher Sir" },
      ...Array.from({ length: 10 }, (_, i) => ({ id: String(100 + i), name: `Student ${i + 1}` })),
    ]);
  });
  await p.waitForTimeout(400);

  const drawn = await p.locator('[data-testid^="livekit-tile-"]').count();
  const budget = label.startsWith("phone") ? 4 : 9;
  // The local self-view is a tile too, and it is inside the budget.
  check(`${label}: only ${budget} tiles are drawn for twelve people`, drawn === budget, `tiles=${drawn}`);
  check(`${label}: and the rest are said, not silently hidden`,
    (await p.locator('[data-testid="livekit-overflow"]').count()) === 1);

  const lastPlan = await p.evaluate(() => window.__plans[window.__plans.length - 1] ?? null);
  check(`${label}: the provider is told which cameras to drop`,
    Boolean(lastPlan) && lastPlan.unsubscribe.length === 12 - budget,
    JSON.stringify(lastPlan));
  check(`${label}: the teacher is never among them`,
    Boolean(lastPlan) && !lastPlan.unsubscribe.includes("2"), JSON.stringify(lastPlan?.unsubscribe));
  check(`${label}: nobody is asked to subscribe and unsubscribe at once`,
    Boolean(lastPlan) && lastPlan.subscribe.every((id) => !lastPlan.unsubscribe.includes(id)));

  check(`${label}: no page error during the run`, errors.length === 0, errors[0] ?? "");

  await browser.close();
}

async function main() {
  const chromium = await getChromium();
  await run(chromium, PHONE, "phone-390");
  await run(chromium, LAPTOP, "laptop-1440");

  console.log(`\nScreenshots: ${SHOTS}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  rmSync(work, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
});
