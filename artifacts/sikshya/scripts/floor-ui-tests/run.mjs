/**
 * The classroom floor on a real screen, at four sizes.
 *
 * `utils/classroomFloorUi.test.ts` proves the right thing is *offered*. This proves it is
 * *drawn* — that the buttons exist, that they are big enough to hit, that a teacher's roster and a
 * student's own row look like what they are, and that none of it overflows a 390-point phone.
 *
 * The component is the one that ships. What is replaced is the socket: `floor` and the actions
 * come in as props, so every state can be produced in order rather than waited for. That is the
 * only honest way to see a student being invited, muted, and sent back to the audience inside one
 * run — against a live class those are three people and twenty minutes.
 *
 * ## What this does not prove
 *
 * That the states it draws are the states the server produces. That is
 * `api-server/scripts/floor-tests`, which drives the real hub against a real database. The two
 * meet at `FloorView`, which both are typed against.
 *
 * Usage, from artifacts/sikshya:  node scripts/floor-ui-tests/run.mjs
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { bundleForBrowser } from "../bundle-for-browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const SHOTS = process.env.FLOOR_SHOT_DIR || path.join(tmpdir(), "floor-shots");

let passed = 0, failed = 0; const failures = [];
const check = (n, ok, d = "") => {
  if (ok) { passed++; console.log(`  ok   ${n}`); }
  else { failed++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  FAIL ${n}${d ? ` — ${d}` : ""}`); }
};

const work = mkdtempSync(path.join(tmpdir(), "floor-ui-"));
mkdirSync(SHOTS, { recursive: true });

const entry = path.join(work, "entry.jsx");
writeFileSync(
  entry,
  `
import React from "react";
import { createRoot } from "react-dom/client";
import ClassroomFloor from ${JSON.stringify(path.join(appRoot, "components", "ClassroomFloor.tsx"))};

/** Every action the component can send, recorded rather than performed. */
window.__sent = [];
const record = (name) => (...args) => { window.__sent.push({ name, args }); };
const actions = {
  ask: record("ask"), cancelAsk: record("cancelAsk"), accept: record("accept"),
  mediaReady: record("mediaReady"),
  setMic: record("setMic"), setCamera: record("setCamera"), decline: record("decline"),
  listenOnly: record("listenOnly"), joinDiscussion: record("joinDiscussion"),
  leaveDiscussion: record("leaveDiscussion"), allow: record("allow"), dismiss: record("dismiss"),
  cancelInvite: record("cancelInvite"), cancelInvites: record("cancelInvites"),
  inviteAll: record("inviteAll"), mute: record("mute"), muteAll: record("muteAll"),
  stopCamera: record("stopCamera"), returnToAudience: record("returnToAudience"),
  startDiscussion: record("startDiscussion"), endDiscussion: record("endDiscussion"),
  spotlight: record("spotlight"),
};

let setScene = null;
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { window.__renderError = String(err && err.stack || err); }
  render() { return this.state.err ? React.createElement("pre", { id: "boom" }, String(this.state.err)) : this.props.children; }
}

function Harness() {
  const [scene, set] = React.useState({ floor: null, refusal: null, opensAt: null, canModerate: true });
  setScene = set;
  return React.createElement(
    "div",
    { style: { width: "100vw", minHeight: "100vh", background: "#FBFAF8", padding: 12, boxSizing: "border-box" } },
    React.createElement(Boundary, null, React.createElement(ClassroomFloor, {
      floor: scene.floor,
      refusal: scene.refusal,
      onDismissRefusal: () => set((s) => ({ ...s, refusal: null })),
      actions,
      discussionOpensAt: scene.opensAt,
      canModerate: scene.canModerate,
    })),
  );
}
createRoot(document.getElementById("root")).render(React.createElement(Harness));
window.__show = (scene) => { window.__sent = []; setScene({ refusal: null, opensAt: null, canModerate: true, ...scene }); };
`,
);


/*
  A stand-in for `expo-font`.

  `@expo/vector-icons` reaches through it to `expo-modules-core`, which imports
  `TurboModuleRegistry` from react-native — a native bridge react-native-web does not have, so the
  bundle fails before a single assertion runs. On the web the package only needs the font *file*,
  which the `.ttf` loader supplies; everything else it asks expo-font is bookkeeping about loading
  state, and answering "already loaded" is true here because the data URL is in the bundle.
*/
const fontStub = path.join(work, "expo-font-stub.js");
writeFileSync(
  fontStub,
  [
    "/* A stand-in for expo-font, small enough to read.",
    "   Two jobs. It keeps @expo/vector-icons from reaching expo-modules-core, which imports",
    "   TurboModuleRegistry from react-native — a native bridge react-native-web does not have, so",
    "   the bundle would fail before a single assertion ran. And it injects the @font-face, because",
    "   a no-op stub bundles fine and draws every icon as an empty box, which in a suite whose whole",
    "   job is to look at the design is worse than failing. The font arrives here as the data URL",
    "   the .ttf loader produced; turning that into a stylesheet rule is all the browser needs. */",
    "const injected = new Set();",
    "function inject(family, source) {",
    "  if (injected.has(family) || typeof document === 'undefined') return;",
    "  const url = typeof source === 'string' ? source : source && (source.uri || source.default);",
    "  if (!url) return;",
    "  injected.add(family);",
    "  const style = document.createElement('style');",
    "  style.textContent = '@font-face { font-family: \"' + family + '\"; src: url(\"' + url + '\"); font-display: block; }';",
    "  document.head.appendChild(style);",
    "}",
    "export async function loadAsync(nameOrMap, source) {",
    "  if (typeof nameOrMap === 'string') inject(nameOrMap, source);",
    "  else for (const [family, src] of Object.entries(nameOrMap || {})) inject(family, src);",
    "}",
    "export function isLoaded(family) { return injected.has(family); }",
    "export function isLoading() { return false; }",
    "export function useFonts(map) { void loadAsync(map); return [true, null]; }",
    "export function processFontFamily(name) { return name; }",
    "export function getLoadedFonts() { return [...injected]; }",
    "export default { loadAsync, isLoaded, isLoading, useFonts, processFontFamily, getLoadedFonts };",
  ].join("\n"),
);

const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({ entry, outfile: bundle, alias: { "expo-font": fontStub } });
if (!built.ok) {
  console.error(built.error);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

const page = path.join(work, "index.html");
writeFileSync(
  page,
  `<!doctype html><html><head><meta charset="utf-8"><title>classroom floor</title>
<style>body{margin:0;font-family:system-ui,sans-serif}</style></head>
<body><div id="root"></div><script src="bundle.js"></script></body></html>`,
);

/* ------------------------------------------------------------------------- */
/* Scenes                                                                     */
/* ------------------------------------------------------------------------- */

const NOW = Date.now();

/*
  `provider: "ok"` is spelled out rather than left off.

  It is what the server sends for somebody the SFU is in step with, and it is the ordinary case, so
  every scene below that does not say otherwise gets it. Leaving it undefined would not mean
  "ordinary" — `studentOffer` treats anything that is not `ok` as not-yet-applied and withholds the
  buttons, which is deliberate and is the point of the field. The two scenes that exercise the other
  two values set it themselves.
*/
const you = (over = {}) => ({
  state: "audience", requestedAt: null, invitedAt: null, invitationScope: null,
  allowedMic: false, allowedCamera: false, acceptedMic: false, acceptedCamera: false,
  provider: "ok", ...over,
});
const asStudent = (yourRow, over = {}) => ({
  scope: "student", mode: "classroom", discussionEligible: false, discussionStartedAt: null,
  spotlight: null, handsUp: 0, queuePosition: null, ...over, you: you(yourRow),
});
const row = (over = {}) => ({
  userId: 11, name: "Sita Sharma", state: "audience", requestedAt: null, invitedAt: null,
  invitationScope: null, connected: true, allowedMic: false, allowedCamera: false,
  provider: "ok", ...over,
});
const asTeacher = (over = {}) => ({
  scope: "teacher", mode: "classroom", discussionEligible: false, discussionStartedAt: null,
  spotlight: null, students: [], queue: [], ...over,
});

const SIZES = [
  { label: "phone-390", width: 390, height: 844 },
  { label: "phone-412", width: 412, height: 915 },
  { label: "tablet-768", width: 768, height: 1024 },
  { label: "laptop-1440", width: 1440, height: 900 },
];

const chromium = await getChromium();

for (const size of SIZES) {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`file://${page}`);
  await p.waitForTimeout(400);

  const L = size.label;
  const show = async (scene, shot) => {
    await p.evaluate((s) => window.__show(s), scene);
    await p.waitForTimeout(160);
    if (shot) await p.screenshot({ path: path.join(SHOTS, `${L}-${shot}.png`), fullPage: false });
  };
  const seen = (id) => p.locator(`[data-testid="${id}"]`).count().then((n) => n > 0);
  const text = (id) => p.locator(`[data-testid="${id}"]`).first().innerText().catch(() => "");
  /*
    A tap, and time for the answer.

    400ms rather than 80: the class list slides out over roughly a third of a second, so a check
    that ran immediately after asking it to close found it still on screen and reported a close
    button that does not work. It does; the sheet was mid-animation.
  */
  const tap = async (id) => { await p.locator(`[data-testid="${id}"]`).first().click(); await p.waitForTimeout(400); };
  const sent = () => p.evaluate(() => window.__sent);

  console.log(`\n[${L}] Nothing to draw`);
  await show({ floor: null });
  check(`${L}: nothing is drawn before the first state arrives`, !(await seen("student-floor")) && !(await seen("teacher-floor")));
  check(`${L}: renders without a page error`, errors.length === 0, errors[0] ?? "");

  await show({ floor: asStudent({}), canModerate: false });
  check(`${L}: nothing is drawn on a provider that cannot enforce a permission`, !(await seen("student-floor")));

  console.log(`\n[${L}] A student, listening`);
  await show({ floor: asStudent({}) }, "student-listening");
  check(`${L}: the strip is there`, await seen("student-floor"));
  check(`${L}: one thing is offered — asking`, await seen("student-floor-ask"));
  check(`${L}: and their own state is shown`, (await text("student-floor-state")).includes("Listening"));
  await tap("student-floor-ask");
  check(`${L}: tapping it asks the server`, JSON.stringify(await sent()) === JSON.stringify([{ name: "ask", args: [] }]));

  console.log(`\n[${L}] A student waiting`);
  await show(
    { floor: asStudent({ state: "requested", requestedAt: NOW }, { queuePosition: 3, handsUp: 4 }) },
    "student-waiting",
  );
  check(`${L}: they are told where they are in the line`, (await text("student-floor-body")).includes("3rd"));
  check(`${L}: and can put their hand down`, await seen("student-floor-cancel"));

  console.log(`\n[${L}] A student invited to speak`);
  await show(
    { floor: asStudent({ state: "allowed-not-accepted", invitedAt: NOW, allowedMic: true, allowedCamera: true }) },
    "student-invited",
  );
  const title = await text("student-floor-title");
  check(`${L}: the invitation is unmistakable`, title.includes("asked you to speak"), title);
  check(`${L}: both ways to accept are offered`,
    (await seen("student-floor-accept-mic")) && (await seen("student-floor-accept-camera")));
  check(`${L}: and declining is one tap`, await seen("student-floor-decline"));
  await tap("student-floor-accept-camera");
  check(`${L}: accepting with a camera sends the camera scope`,
    JSON.stringify(await sent()) === JSON.stringify([{ name: "accept", args: ["mic+camera"] }]));

  console.log(`\n[${L}] A student speaking, and turned off`);
  await show(
    { floor: asStudent({ state: "camera-active", allowedMic: true, allowedCamera: true, acceptedMic: true, acceptedCamera: true }) },
    "student-on-camera",
  );
  check(`${L}: the camera can be turned off without ending the turn`, await seen("student-floor-camera"));
  await tap("student-floor-camera");
  check(`${L}: which sends the one switch`,
    JSON.stringify(await sent()) === JSON.stringify([{ name: "setCamera", args: [false] }]));

  await show({ floor: asStudent({ state: "muted-by-teacher", allowedMic: true }) }, "student-muted");
  const muted = await text("student-floor-title");
  check(`${L}: being turned off says who did it`, muted.includes("Your teacher turned"), muted);
  check(`${L}: and never reads as a punishment`, (await text("student-floor-body")).includes("hand up again"));

  console.log(`\n[${L}] The video has not caught up with the decision`);
  /*
    Drawn, not merely computed.

    A grant the SFU has not accepted must not look like a grant. The unit test next door proves
    `studentOffer` withholds the buttons; this proves the component draws the waiting sentence
    instead of an unmute a student would press and be refused by the SFU with no explanation —
    which is the failure Codex's second finding names.
  */
  await show(
    { floor: asStudent({ state: "allowed-not-accepted", allowedMic: true, provider: "pending" }) },
    "student-provider-pending",
  );
  const waitingOn = await text("student-floor-title");
  check(`${L}: a grant still going through says so`, waitingOn.includes("Switching your microphone on"), waitingOn);
  check(`${L}: and offers nothing to press while it is in flight`, !(await seen("student-floor-accept-mic")));

  await show(
    { floor: asStudent({ state: "allowed-not-accepted", allowedMic: true, provider: "failed" }) },
    "student-provider-failed",
  );
  const stuck = await text("student-floor-title");
  check(`${L}: a grant the video refused says that too`, stuck.includes("could not be switched on"), stuck);
  check(`${L}: and the one thing offered is asking again`,
    (await seen("student-floor-ask")) && !(await seen("student-floor-accept-mic")));

  /*
    The other direction, which matters more.

    A mute the SFU never accepted leaves a child audible to the whole class. The screen has to say
    so — and must never say the opposite, which is what an earlier version of this guard did by
    reading the permission flag a muted student still carries.
  */
  await show(
    { floor: asStudent({ state: "muted-by-teacher", allowedMic: true, provider: "failed" }) },
    "student-provider-mute-failed",
  );
  const stillOn = await text("student-floor-title");
  check(`${L}: a mute the video never took says the microphone may still be live`,
    stillOn.includes("could not confirm your microphone is off"), stillOn);
  check(`${L}: and never that it is being switched on`, !stillOn.includes("Switching"), stillOn);

  await show({ floor: asStudent({ state: "speaking", allowedMic: true, acceptedMic: true, provider: "pending" }) });
  check(`${L}: a student already speaking keeps the control that stops them`,
    await seen("student-floor-stop"));
  check(`${L}: and is told the video has not caught up`, await seen("student-floor-provider"));

  console.log(`\n[${L}] A refusal`);
  await show(
    {
      floor: asStudent({}),
      refusal: { action: "accept", code: "not-allowed", reason: "Your teacher has not let you speak yet." },
    },
    "student-refused",
  );
  check(`${L}: the server's own sentence is shown, not a generic apology`,
    (await text("floor-refusal")).includes("not let you speak yet"));

  console.log(`\n[${L}] A discussion`);
  await show(
    { floor: asStudent({}, { mode: "discussion", discussionEligible: true }) },
    "student-discussion",
  );
  check(`${L}: three ways in, and listening is one`,
    (await seen("student-floor-discussion-mic")) &&
      (await seen("student-floor-discussion-camera")) &&
      (await seen("student-floor-discussion-listen")));

  console.log(`\n[${L}] The teacher's strip`);
  const classRows = [
    row({ userId: 11, name: "Sita Sharma", state: "requested", requestedAt: NOW }),
    row({ userId: 22, name: "Ram Bahadur", state: "speaking", allowedMic: true }),
    row({ userId: 33, name: "Gita Thapa", state: "camera-active", allowedMic: true, allowedCamera: true }),
    row({ userId: 44, name: "Bikash Karki", state: "disconnected", connected: false }),
    row({ userId: 55, name: "Anjali Gurung" }),
  ];
  await show({ floor: asTeacher({ students: classRows, queue: [11] }) }, "teacher-strip");
  check(`${L}: the class list is one tap away`, await seen("teacher-floor-participants"));
  check(`${L}: a raised hand is badged`, await seen("teacher-floor-hands"));
  check(`${L}: and the two whole-class controls are there`,
    (await seen("teacher-floor-invite-all")) && (await seen("teacher-floor-mute-all")));
  check(`${L}: a pay-as-you-go class has no discussion control at all`, !(await seen("teacher-floor-discussion")));

  await show({ floor: asTeacher({ students: classRows, queue: [11], discussionEligible: true }), opensAt: NOW + 12 * 60_000 });
  check(`${L}: a monthly class shows the discussion, and when it opens`,
    (await seen("teacher-floor-discussion")) && (await text("teacher-floor-discussion-hint")).includes("Opens in"));

  console.log(`\n[${L}] The class list`);
  await show({ floor: asTeacher({ students: classRows, queue: [11] }) });
  await tap("teacher-floor-participants");
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, `${L}-teacher-sheet.png`) });
  check(`${L}: the sheet opens`, await seen("participant-sheet"));
  check(`${L}: everybody is listed, including the person who dropped`,
    (await seen("participant-row-11")) && (await seen("participant-row-44")));
  check(`${L}: the raised hand is first`, await p.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid^="participant-row-"]')];
    return rows[0]?.getAttribute("data-testid") === "participant-row-11";
  }));
  check(`${L}: a raised hand offers the three answers`,
    (await seen("participant-11-allow-mic")) && (await seen("participant-11-allow-camera")) && (await seen("participant-11-dismiss")));
  check(`${L}: a student who dropped is offered nothing`, !(await seen("participant-44-allow-mic")));
  check(`${L}: the camera button warns it is taking somebody's camera`,
    (await text("participant-11-allow-camera")).includes("Take the camera"));

  await tap("participant-22-mute");
  check(`${L}: muting names the right student`,
    JSON.stringify(await sent()) === JSON.stringify([{ name: "mute", args: [22] }]));


  /*
    The sheet survives the answer coming back.

    A teacher moderating a class gets a new floor state every time anybody does anything; a sheet
    that closed on each one would shut itself the moment they used it. Asserted rather than
    assumed, because it is the sort of thing a later refactor breaks without anybody noticing
    until a teacher is mid-lesson.
  */
  await show({ floor: asTeacher({ students: classRows, queue: [11], spotlight: 22 }) });
  check(`${L}: the sheet stays open when the class changes underneath it`, await seen("participant-sheet"));
  await tap("participant-sheet-close");
  check(`${L}: and closes when asked`, !(await seen("participant-sheet")));

  console.log(`\n[${L}] Rows the video has not caught up with`);
  /*
    The half of Codex's second finding that lives on the teacher's list.

    A mute that never reached LiveKit used to be drawn exactly like one that landed, so a teacher
    believed a microphone was off while the class could still hear it. The chip says otherwise, and
    the controls stay — pressing mute again is how a failed revocation is retried.
  */
  await show({ floor: asTeacher({
    students: [
      row({ userId: 22, name: "Ram Bahadur", state: "speaking", allowedMic: true, provider: "failed" }),
      row({ userId: 55, name: "Anjali Gurung", state: "allowed-not-accepted", allowedMic: true, provider: "pending" }),
    ],
    queue: [],
  }) });
  await tap("teacher-floor-participants");
  await p.screenshot({ path: path.join(SHOTS, `${L}-teacher-sheet-provider.png`) });
  check(`${L}: a row the video refused is marked as such`, await seen("participant-provider-22"));
  check(`${L}: in words about the class, not about a server`,
    (await text("participant-provider-22")).includes("Could not reach"), await text("participant-provider-22"));
  check(`${L}: a row still going through is marked differently`,
    (await text("participant-provider-55")).includes("Not applied yet"), await text("participant-provider-55"));
  check(`${L}: and a stuck row keeps the controls that unstick it`, await seen("participant-22-mute"));
  await tap("participant-sheet-close");

  console.log(`\n[${L}] Nobody has joined`);
  await show({ floor: asTeacher({}) });
  await tap("teacher-floor-participants");
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, `${L}-teacher-sheet-empty.png`) });
  check(`${L}: an empty class says so, rather than showing a blank sheet`,
    (await p.locator("text=Nobody has joined yet.").count()) === 1);
  await tap("participant-sheet-close");
  check(`${L}: and the sheet closes`, !(await seen("participant-sheet")));

  console.log(`\n[${L}] Nothing runs off the side`);
  await show({ floor: asStudent({ state: "allowed-not-accepted", invitedAt: NOW, allowedMic: true, allowedCamera: true }) });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${L}: the student strip does not scroll sideways`, overflow <= 1, `overflow=${overflow}px`);

  await show({ floor: asTeacher({ students: classRows, queue: [11], discussionEligible: true }), opensAt: NOW - 60_000 });
  const teacherOverflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${L}: nor does the teacher strip`, teacherOverflow <= 1, `overflow=${teacherOverflow}px`);

  console.log(`\n[${L}] Nothing is cut off`);
  /*
    The check the screenshots caught and the assertions did not.

    Every control had `flexBasis: 0`, so a row of three made them all the same width whatever they
    said, and on a phone the teacher's list read "Let them …", "Take t…", "Came…". A moderation
    button a teacher cannot read is worse than no button. Measured by comparing each label's laid
    out width against the width it would need — `scrollWidth` exceeding `clientWidth` is the
    browser saying it had to cut something.
  */
  const clipped = async () => p.evaluate(() =>
    [...document.querySelectorAll('[role="button"] div[dir="auto"]')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.textContent} (${el.clientWidth} < ${el.scrollWidth})`));

  await show({ floor: asStudent({ state: "allowed-not-accepted", invitedAt: NOW, allowedMic: true, allowedCamera: true }) });
  let cut = await clipped();
  check(`${L}: no student control is cut off`, cut.length === 0, cut.join(" | "));

  await show({ floor: asTeacher({ students: classRows, queue: [11], discussionEligible: true }), opensAt: NOW - 60_000 });
  cut = await clipped();
  check(`${L}: no control on the teacher's strip is cut off`, cut.length === 0, cut.join(" | "));
  await tap("teacher-floor-participants");
  cut = await clipped();
  check(`${L}: no control in the class list is cut off`, cut.length === 0, cut.join(" | "));
  await tap("participant-sheet-close");

  console.log(`\n[${L}] Every control can be hit`);
  await show({ floor: asStudent({ state: "allowed-not-accepted", invitedAt: NOW, allowedMic: true, allowedCamera: true }) });
  const small = await p.evaluate(() => {
    const out = [];
    // Buttons only: the title and the body line under it are text, and text is not a target.
    for (const el of document.querySelectorAll('[data-testid^="student-floor-"][role="button"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.height < 44) out.push(`${el.getAttribute("data-testid")} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  check(`${L}: every student control is at least 44 high`, small.length === 0, small.join(", "));

  check(`${L}: still no page errors after everything`, errors.length === 0, errors[0] ?? "");
  await browser.close();
}

rmSync(work, { recursive: true, force: true });
console.log(`\nScreenshots: ${SHOTS}`);
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
