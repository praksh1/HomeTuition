/**
 * The teacher program studio, on a real screen, at a phone and at a laptop.
 *
 * `utils/learningProgramUi.test.ts` proves the right thing is *decided*. This proves it is *drawn* —
 * that the sections exist, the controls are big enough to hit, nothing overflows a 390-point phone,
 * the four states read differently, and none of the screens shows a number nobody has.
 *
 * The components are the ones that ship. What is replaced is the network: every screen takes its
 * data and its callbacks as props, so each state can be produced in order rather than waited for.
 * Against a live API these would be four teachers and an operator review.
 *
 * ## What this does not prove
 *
 * That the screens are wired to the API correctly. That is `app/(teacher)/programs/*`, which is
 * deliberately thin, and `api-server/scripts/learning-program-tests`, which drives the real routes.
 * The two meet at the props below, which are typed against the same module the screens use.
 *
 * Usage, from artifacts/sikshya:  node scripts/program-studio/run.mjs
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { bundleForBrowser } from "../bundle-for-browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const SHOTS = process.env.PROGRAM_SHOT_DIR || path.join(tmpdir(), "program-shots");

let passed = 0, failed = 0; const failures = [];
const check = (n, ok, d = "") => {
  if (ok) { passed++; console.log(`  ok   ${n}`); }
  else { failed++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  FAIL ${n}${d ? ` — ${d}` : ""}`); }
};

const work = mkdtempSync(path.join(tmpdir(), "program-ui-"));
mkdirSync(SHOTS, { recursive: true });

const entry = path.join(work, "entry.jsx");
writeFileSync(
  entry,
  `
import React from "react";
import { createRoot } from "react-dom/client";
import ProgramHome from ${JSON.stringify(path.join(appRoot, "components", "programs", "ProgramHome.tsx"))};
import ProgramTypeChooser from ${JSON.stringify(path.join(appRoot, "components", "programs", "ProgramTypeChooser.tsx"))};
import ProgramStudio from ${JSON.stringify(path.join(appRoot, "components", "programs", "ProgramStudio.tsx"))};
import { offerableTypes } from ${JSON.stringify(path.join(appRoot, "utils", "learningProgramUi.ts"))};

/** Every callback, recorded rather than performed. */
window.__sent = [];
const record = (name) => (...args) => { window.__sent.push({ name, args }); };

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { window.__renderError = String(err && err.stack || err); }
  render() { return this.state.err ? React.createElement("pre", { id: "boom" }, String(this.state.err)) : this.props.children; }
}

let setScene = null;
/** Bumped on every scene change, so the boundary above never carries an error into the next one. */
let renders = 0;

/*
  The studio owns nothing; the screen does, and so does this.

  Its own component rather than a branch inside Harness, because a useState called only when one
  scene is showing is a conditional hook — React throws the moment the scene changes, and every
  assertion after that point fails against an empty page for a reason that has nothing to do with
  the design. Holding the draft here makes typing in the harness behave exactly as it does in the
  app, which is what makes the overflow and clipping checks mean anything.

  (No backticks in this comment: it lives inside a template literal, and one would end the string.)
*/
function StudioHost(props) {
  const [draft, setDraft] = React.useState(props.draft);
  React.useEffect(() => { setDraft(props.draft); }, [props.draft]);
  return React.createElement(ProgramStudio, { ...props, draft, onDraftChange: setDraft });
}

function Harness() {
  /*
    A real first scene, and a boundary that is remounted for each one.

    Both were bugs. An initial scene of {} rendered the home screen with no programs array, which
    threw; the boundary then latched on its own state and every later scene showed the same caught
    error instead of the screen under test — eight confusing locator timeouts for one mistake at
    render zero. Keying the boundary on the scene means a caught error belongs to the scene that
    caused it and nothing after.
  */
  const [scene, set] = React.useState({
    screen: "home",
    props: { programs: [], loading: false, failure: null },
  });
  setScene = set;
  const common = {
    onRetry: record("onRetry"), onOpen: record("onOpen"), onCreate: record("onCreate"),
    onChoose: record("onChoose"), onCancel: record("onCancel"), onBack: record("onBack"),
    onSave: record("onSave"), onAction: record("onAction"),
  };
  const sceneKey = JSON.stringify([scene.screen, Object.keys(scene.props ?? {})]) + String(renders);
  let element = null;
  if (scene.screen === "home") element = React.createElement(ProgramHome, { ...common, ...scene.props });
  if (scene.screen === "chooser") {
    /*
      The driver sends what the *server* returned; the narrowing happens here, through the real
      function. Passing a ready-made choices array would have the suite assert against a copy of the
      rule written in the test, which is how a menu and its test agree while both are wrong.
    */
    const { templates, ...rest } = scene.props ?? {};
    element = React.createElement(ProgramTypeChooser, {
      ...common, ...rest, choices: offerableTypes(templates ?? []),
    });
  }
  if (scene.screen === "studio") {
    /*
      A function cannot cross into the page as a prop, so the driver sends the string "__fn__" where
      one is wanted and it becomes a recorder here. Only leaveAsk needs it: its presence is what
      makes the studio ask the question, and the screen above is what decides where leaving goes.

      (No backticks in this comment: it lives inside a template literal, and one would end it.)
    */
    const props = { ...scene.props };
    if (props.leaveAsk === "__fn__") props.leaveAsk = record("leaveAsk");
    element = React.createElement(StudioHost, { ...common, ...props });
  }
  return React.createElement(
    "div",
    { style: { width: "100vw", minHeight: "100vh", background: "#FBFAF8" } },
    React.createElement(Boundary, { key: sceneKey }, element),
  );
}
createRoot(document.getElementById("root")).render(React.createElement(Harness));
window.__show = (scene) => { window.__sent = []; renders += 1; setScene({ ...scene }); };
`,
);

/*
  A stand-in for `expo-font`, copied from `floor-ui-tests` for the same two reasons: it keeps
  `@expo/vector-icons` from reaching `expo-modules-core`, which imports a native bridge
  react-native-web does not have, and it injects the `@font-face` so icons are glyphs rather than
  empty boxes — which in a suite that looks at a design is worse than failing.
*/
const fontStub = path.join(work, "expo-font-stub.js");
writeFileSync(
  fontStub,
  [
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
  `<!doctype html><html><head><meta charset="utf-8"><title>program studio</title>
<style>body{margin:0;font-family:system-ui,sans-serif}</style></head>
<body><div id="root"></div><script src="bundle.js"></script></body></html>`,
);

/* ------------------------------------------------------------------------- */
/* Scenes                                                                     */
/* ------------------------------------------------------------------------- */

const MODULES = [
  { title: "Where we start", outcome: "Know what the first lesson covers and why it comes first." },
  { title: "Practising it", outcome: "Work through examples every week with feedback." },
  { title: "Putting it together", outcome: "Solve a full past paper without help." },
];

const draft = (over = {}) => ({
  type: "custom",
  title: "Grade 10 Mathematics, term by term",
  summary: "What this covers, who it suits, and how the weeks are spent together.",
  outcome: "Students can work through a whole past paper with support.",
  intendedLearner: "Students in Grade 10 preparing for the board examination",
  startingLevel: "Comfortable with Grade 9 arithmetic",
  teachingLanguage: "Nepali and English",
  prerequisites: null,
  equipment: null,
  referenceName: null,
  referenceSource: "none",
  modules: MODULES,
  ...over,
});

const detail = (over = {}) => ({
  id: 12,
  status: "draft",
  type: "custom",
  title: "Grade 10 Mathematics, term by term",
  version: 0,
  draft: draft(over.draft ?? {}),
  issues: [],
  published: null,
  hasUnpublishedChanges: false,
  ...over,
});

/** What a healthy `GET /learning-programs/templates` returns, as far as this screen is concerned. */
const ALL_TEMPLATES = [
  { type: "school_subject" }, { type: "exam_preparation" }, { type: "language" },
  { type: "practical_skill" }, { type: "custom" },
];

const SIZES = [
  { label: "phone-390", width: 390, height: 844 },
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
    await p.evaluate((s) => { window.__renderError = null; window.__show(s); }, scene);
    await p.waitForTimeout(200);
    /*
      A render error is reported here rather than left to become eight confusing locator timeouts.

      React reports a thrown render through its own channel, so `pageerror` stays quiet and the
      first sign is an assertion failing against a blank page — half an hour of looking at the wrong
      thing, which this project has already spent once.
    */
    const boom = await p.evaluate(() => window.__renderError ?? null);
    if (boom) check(`${L}: ${shot ?? scene.screen} renders`, false, String(boom).slice(0, 200));
    if (shot) await p.screenshot({ path: path.join(SHOTS, `${L}-${shot}.png`), fullPage: true });
  };
  const seen = (id) => p.locator(`[data-testid="${id}"]`).count().then((n) => n > 0);
  const text = (id) => p.locator(`[data-testid="${id}"]`).first().innerText().catch(() => "");
  const body = () => p.locator("body").innerText().catch(() => "");

  /** The page must never scroll sideways. Wide content scrolls inside its own box or wraps. */
  const overflow = () =>
    p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  /** Anything a finger has to hit is at least 44 high. DESIGN.md's floor, and people miss below it. */
  const smallTargets = () =>
    p.evaluate(() =>
      [...document.querySelectorAll('[role="button"], [role="link"], input, textarea')]
        .filter((el) => el.getBoundingClientRect().height > 0)
        .filter((el) => el.getBoundingClientRect().height < 44)
        .map((el) => `${el.getAttribute("data-testid") ?? el.tagName}:${Math.round(el.getBoundingClientRect().height)}`));

  /** A label the browser had to cut. `scrollWidth` beyond `clientWidth` is the browser saying so. */
  const clipped = () =>
    p.evaluate(() =>
      [...document.querySelectorAll('[role="button"] div[dir="auto"], [role="link"]')]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.textContent} (${el.clientWidth} < ${el.scrollWidth})`));

  /* ------------------------------------------------------------- program home */

  console.log(`\n[${L}] Program home`);

  await show({ screen: "home", props: { programs: [], loading: true, failure: null } }, "home-loading");
  check(`${L}: loading is skeletons in the shape of the cards, not a spinner`, await seen("program-home-loading"));
  check(`${L}: and never the empty state`, !(await seen("program-home-empty")),
    "loading, empty and failed are three different pictures");

  await show({ screen: "home", props: { programs: [], loading: false, failure: null } }, "home-empty");
  check(`${L}: the empty state explains what a program is`, await seen("program-home-empty"));
  const empty = await text("program-home-empty");
  check(`${L}: and says plainly that it is not a single class`, /not a single class/i.test(empty), empty.slice(0, 120));
  check(`${L}: with one way forward`, await seen("program-home-create-first"));

  await show({
    screen: "home",
    props: {
      programs: [],
      loading: false,
      failure: "Fadko could not reach the server. Check your connection and try again.",
    },
  }, "home-failed");
  check(`${L}: a failed load says so`, await seen("program-failure"));
  check(`${L}: and is never drawn as "no programs yet"`, !(await seen("program-home-empty")),
    "a failed load rendered as empty tells a teacher their work is gone");
  check(`${L}: with a way to try again`, await seen("program-failure-retry"));

  const list = [
    { id: 1, status: "published", type: "school_subject", title: "Grade 10 Mathematics, term by term", version: 2 },
    { id: 2, status: "draft", type: "practical_skill", title: "Beginner guitar from the first chord", version: 0 },
    { id: 3, status: "draft", type: "language", title: null, version: 0 },
    { id: 4, status: "archived", type: "exam_preparation", title: "Engineering registration exam preparation", version: 1 },
  ];
  await show({ screen: "home", props: { programs: list, loading: false, failure: null } }, "home-list");
  check(`${L}: every program the teacher has is shown`,
    (await seen("program-card-1")) && (await seen("program-card-2")) && (await seen("program-card-3")) && (await seen("program-card-4")));
  check(`${L}: grouped by what needs doing with them`,
    (await seen("program-group-live")) && (await seen("program-group-working")) && (await seen("program-group-archived")));
  check(`${L}: a program with no name yet is called something`,
    (await text("program-card-3")).includes("Untitled program"));
  check(`${L}: each status is legible on the card`,
    (await text("program-status-1")) === "Published" &&
      (await text("program-status-2")) === "Draft" &&
      (await text("program-status-4")) === "Archived",
    `${await text("program-status-1")} / ${await text("program-status-2")} / ${await text("program-status-4")}`);

  const home = await body();
  for (const invented of ["students", "rating", "NPR", "earned", "Popular", "Available"]) {
    check(`${L}: the list invents no ${invented}`, !home.includes(invented), home.slice(0, 160));
  }
  check(`${L}: the list does not scroll sideways`, (await overflow()) <= 1, `overflow ${await overflow()}px`);
  check(`${L}: no control on the list is below the touch floor`, (await smallTargets()).length === 0,
    (await smallTargets()).join(", "));

  /* ------------------------------------------------------------- create flow */

  console.log(`\n[${L}] Choosing a kind of program`);
  await show({
    screen: "chooser",
    props: { templates: ALL_TEMPLATES, loading: false, failure: null, creating: null },
  }, "chooser");
  for (const type of ["school_subject", "exam_preparation", "language", "practical_skill", "custom"]) {
    check(`${L}: ${type} is offered`, await seen(`program-type-${type}`));
    const card = await text(`program-type-${type}`);
    check(`${L}: ${type} explains what it is for`, card.split("\n").length >= 2 && card.length > 40, card.slice(0, 80));
  }
  check(`${L}: the exam choice says results are not promised`,
    /no promises about results/i.test(await text("program-type-exam_preparation")));
  check(`${L}: leaving without creating anything is offered`, await seen("program-type-cancel"));
  check(`${L}: the chooser does not scroll sideways`, (await overflow()) <= 1, `overflow ${await overflow()}px`);
  check(`${L}: nothing on the chooser is cut off`, (await clipped()).length === 0, (await clipped()).join(" | "));

  /*
    What the server offers is what the menu shows.

    Drawing all five whatever came back meant a teacher could tap a card and be handed an error for
    a choice the screen had just invited them to make.
  */
  await show({
    screen: "chooser",
    props: {
      templates: [{ type: "school_subject" }, { type: "custom" }],
      loading: false, failure: null, creating: null,
    },
  });
  check(`${L}: only the kinds the server returned are offered`,
    (await seen("program-type-school_subject")) && (await seen("program-type-custom")));
  check(`${L}: and a kind it did not return is not on the screen`,
    !(await seen("program-type-language")) && !(await seen("program-type-exam_preparation")) &&
      !(await seen("program-type-practical_skill")));

  await show({
    screen: "chooser",
    props: { templates: [{ type: "something_new" }], loading: false, failure: null, creating: null },
  });
  check(`${L}: a server offering nothing this build knows says so`, await seen("program-type-none"));
  check(`${L}: rather than drawing a card that would fail on tap`,
    !(await seen("program-type-custom")));

  /* ----------------------------------------------------------------- studio */

  console.log(`\n[${L}] The studio`);
  await show({
    screen: "studio",
    props: { program: detail(), draft: draft(), saveState: "clean", saveError: null, approved: true, busyAction: null, actionError: null },
  }, "studio-custom");

  for (const section of ["learn", "who", "path", "requirements", "reference", "review"]) {
    check(`${L}: the ${section} section is there`, await seen(`program-section-${section}`));
  }
  check(`${L}: the learning path can be added to`, await seen("program-modules-add"));
  check(`${L}: every step has move up, move down and remove`,
    (await seen("program-module-0-up")) && (await seen("program-module-0-down")) && (await seen("program-module-0-remove")));
  check(`${L}: the first step cannot move up`,
    (await p.locator('[data-testid="program-module-0-up"]').getAttribute("aria-disabled")) === "true");
  check(`${L}: the last step cannot move down`,
    (await p.locator('[data-testid="program-module-2-down"]').getAttribute("aria-disabled")) === "true");
  check(`${L}: no drag handle is required anywhere`,
    !(await body()).toLowerCase().includes("drag"), "a long-press drag on a cheap Android fails often");

  check(`${L}: the studio does not scroll sideways`, (await overflow()) <= 1, `overflow ${await overflow()}px`);
  check(`${L}: no control in the studio is below the touch floor`, (await smallTargets()).length === 0,
    (await smallTargets()).join(", "));
  check(`${L}: nothing in the studio is cut off`, (await clipped()).length === 0, (await clipped()).join(" | "));

  /* --- progressive disclosure ------------------------------------------- */

  await show({
    screen: "studio",
    props: {
      program: detail({ type: "practical_skill", draft: { type: "practical_skill" } }),
      draft: draft({ type: "practical_skill", title: "Beginner guitar from the first chord" }),
      saveState: "clean", saveError: null, approved: true, busyAction: null, actionError: null,
    },
  }, "studio-skill");
  check(`${L}: a guitar program is not asked for a curriculum`, !(await seen("program-section-reference")),
    "the blueprint's own example of a teacher pushed through a school form");
  check(`${L}: and is asked what equipment students need`,
    (await text("program-section-requirements")).toLowerCase().includes("equipment"));

  await show({
    screen: "studio",
    props: {
      program: detail({ type: "exam_preparation", draft: { type: "exam_preparation" } }),
      draft: draft({ type: "exam_preparation", title: "Engineering registration exam preparation" }),
      saveState: "clean", saveError: null, approved: true, busyAction: null, actionError: null,
    },
  }, "studio-exam");
  check(`${L}: an exam program is asked for its exact exam`, await seen("program-section-reference"));
  const examSection = await text("program-section-reference");
  check(`${L}: and told why it is being asked`, /exactly as it is written/i.test(examSection), examSection.slice(0, 140));

  /* --- save states -------------------------------------------------------- */

  console.log(`\n[${L}] Saving`);
  for (const [state, label] of [
    ["clean", "All changes saved"],
    ["unsaved", "Unsaved changes"],
    ["saving", "Saving…"],
    ["saved", "Saved"],
    ["failed", "Save failed"],
  ]) {
    await show({
      screen: "studio",
      props: { program: detail(), draft: draft(), saveState: state, saveError: state === "failed" ? "The server did not answer." : null, approved: true, busyAction: null, actionError: null },
    }, state === "failed" ? "studio-save-failed" : undefined);
    check(`${L}: ${state} reads as "${label}"`, (await text("program-studio-save")) === label,
      await text("program-studio-save"));
  }
  check(`${L}: a failed save explains and offers another try`,
    (await seen("program-studio-save-failed")) && (await seen("program-studio-save-retry")));
  const failedText = await text("program-studio-save-failed");
  check(`${L}: and says the work is still on the screen`, /still on this screen/i.test(failedText), failedText.slice(0, 120));

  /* --- nothing dangerous runs over unsaved work ---------------------------- */

  console.log(`\n[${L}] What is withheld while work is at risk`);

  /*
    Publish, take down, archive and restore all act on the copy the server has and then take the
    answer as the editor's new baseline. Over unsaved text that publishes the wrong words and then
    overwrites the right ones. Delete stays, because discarding is what it is for.
  */
  for (const state of ["unsaved", "saving", "failed"]) {
    await show({
      screen: "studio",
      props: {
        program: detail({ status: "published", version: 1, published: { version: 1 }, hasUnpublishedChanges: true }),
        draft: draft(), saveState: state,
        saveError: state === "failed" ? "The server did not answer." : null,
        approved: true, busyAction: null, actionError: null,
      },
    }, state === "unsaved" ? "studio-at-risk" : undefined);
    check(`${L}: ${state} — publishing is not offered`, !(await seen("program-publish")));
    check(`${L}: ${state} — nor taking down or archiving`,
      !(await seen("program-action-unpublish")) && !(await seen("program-action-archive")));
    check(`${L}: ${state} — and the reason is on screen`, await seen("program-actions-blocked"));
    const why = await text("program-actions-blocked");
    check(`${L}: ${state} — which says to save first`, /save your draft before publishing/i.test(why),
      why.slice(0, 120));
  }

  await show({
    screen: "studio",
    props: {
      program: detail({ status: "archived", version: 1, published: { version: 1 } }),
      draft: draft(), saveState: "unsaved", saveError: null, approved: true, busyAction: null, actionError: null,
    },
  });
  check(`${L}: restoring is withheld too, not just the publishing half`,
    !(await seen("program-action-restore")) && (await seen("program-actions-blocked")));

  await show({
    screen: "studio",
    props: {
      program: detail(),
      draft: draft(), saveState: "unsaved", saveError: null, approved: true, busyAction: null, actionError: null,
    },
  });
  check(`${L}: a never-published draft may still be deleted with work at risk`,
    await seen("program-action-delete"), "discarding the work is the point of it");
  await p.locator('[data-testid="program-action-delete"]').click();
  await p.waitForTimeout(200);
  const deleteAsk = await text("program-confirm-delete");
  check(`${L}: and the confirmation says the unsaved work goes too`,
    /not saved/i.test(deleteAsk), deleteAsk.slice(0, 200));
  await p.locator('[data-testid="program-confirm-delete-cancel"]').click();
  await p.waitForTimeout(150);

  /* --- the readiness check describes the draft it was run against ---------- */

  await show({
    screen: "studio",
    props: {
      program: detail({ issues: [{ field: "outcome", code: "required", message: "Learning outcome is required." }] }),
      draft: draft({ outcome: "Typed since, and not saved" }),
      saveState: "unsaved", saveError: null, approved: true, busyAction: null, actionError: null,
    },
  }, "studio-stale-issues");
  check(`${L}: while dirty, what is marked says which draft it was checked against`,
    await seen("program-studio-stale-issues"));
  const staleChip = await text("program-heading-learn-issues");
  check(`${L}: and the count does not claim to describe the text on screen`,
    /at your last save/i.test(staleChip) && !/to finish/i.test(staleChip), JSON.stringify(staleChip));
  /*
    The line beside the field is the one that matters most, and it was the last to be fixed.

    A red "Learning outcome is required." sitting under a box a teacher has just filled in is simply
    a false sentence, drawn in the app's loudest colour — so it is the false thing they read first.
  */
  const staleField = await text("program-issue-outcome");
  check(`${L}: and neither does the line beside the field`,
    /at your last save/i.test(staleField), JSON.stringify(staleField));

  /* --- leaving with work at risk ------------------------------------------- */

  await show({
    screen: "studio",
    props: {
      program: detail(), draft: draft(), saveState: "unsaved", saveError: null,
      approved: true, busyAction: null, actionError: null,
      leaveAsk: "__fn__",
    },
  }, "studio-leaving");
  check(`${L}: a departure with unsaved work is questioned`, await seen("program-leave-confirm"));
  const leaving = await text("program-leave-confirm");
  check(`${L}: and says what leaving costs`, /loses what you have typed/i.test(leaving), leaving.slice(0, 140));
  check(`${L}: with all three ways out named`,
    (await seen("program-leave-stay")) && (await seen("program-leave-discard")) && (await seen("program-leave-cancel")));

  /* --- review and publication -------------------------------------------- */

  console.log(`\n[${L}] Review and publication`);

  await show({
    screen: "studio",
    props: {
      program: detail({ issues: [
        { field: "outcome", code: "required", message: "Learning outcome is required." },
        { field: "modules.1.title", code: "required", message: "Step 2 title is required." },
      ] }),
      draft: draft({ outcome: "" }),
      saveState: "clean", saveError: null, approved: true, busyAction: null, actionError: null,
    },
  }, "studio-issues");
  check(`${L}: a field issue is drawn beside its field`, await seen("program-issue-outcome"));
  check(`${L}: a step issue is drawn on its step`, await seen("program-module-1-issue"));
  check(`${L}: the section heading counts what is left`, await seen("program-heading-learn-issues"));
  check(`${L}: publication says how much is left rather than being silently disabled`,
    await seen("program-publish-blocked-incomplete"));
  check(`${L}: and Publish is not offered while it would be refused`, !(await seen("program-publish")));

  await show({
    screen: "studio",
    props: { program: detail(), draft: draft(), saveState: "clean", saveError: null, approved: false, busyAction: null, actionError: null },
  }, "studio-unapproved");
  check(`${L}: an unapproved teacher sees a locked publication explanation`,
    await seen("program-publish-blocked-approval"));
  const locked = await text("program-publish-blocked-approval");
  check(`${L}: which says they may keep writing`, /write and save as much as you like/i.test(locked), locked.slice(0, 140));

  await show({
    screen: "studio",
    props: {
      program: detail({ status: "published", version: 1, published: { version: 1 }, hasUnpublishedChanges: true }),
      draft: draft({ outcome: "Something the teacher changed after publishing." }),
      saveState: "clean", saveError: null, approved: true, busyAction: null, actionError: null,
    },
  }, "studio-unpublished-changes");
  check(`${L}: the draft and what students see are told apart`,
    (await seen("program-review-live")) && (await seen("program-review-draft")));
  check(`${L}: unpublished edits are explained in plain language`, await seen("program-review-unpublished"));
  const unpublished = await text("program-review-unpublished");
  check(`${L}: naming what students still see`, /students still see the version above/i.test(unpublished),
    unpublished.slice(0, 140));
  check(`${L}: publishing a change is offered explicitly`,
    (await text("program-publish")).includes("Publish your changes"), await text("program-publish"));

  /* --- destructive actions ------------------------------------------------ */

  console.log(`\n[${L}] Taking it down, away and gone`);
  await show({
    screen: "studio",
    props: { program: detail(), draft: draft(), saveState: "clean", saveError: null, approved: true, busyAction: null, actionError: null },
  });
  check(`${L}: a never-published draft may be deleted`, await seen("program-action-delete"));
  check(`${L}: and there is no note explaining a missing delete`, !(await seen("program-delete-withheld")));

  await show({
    screen: "studio",
    props: {
      program: detail({ status: "published", version: 1, published: { version: 1 } }),
      draft: draft(), saveState: "clean", saveError: null, approved: true, busyAction: null, actionError: null,
    },
  }, "studio-published");
  check(`${L}: a published program is never offered permanent deletion`, !(await seen("program-action-delete")),
    "the page is the only record of what students were promised");
  check(`${L}: and the absence is explained rather than left as a missing feature`,
    await seen("program-delete-withheld"));
  check(`${L}: taking it down and archiving are both offered`,
    (await seen("program-action-unpublish")) && (await seen("program-action-archive")));
  /*
    Two sentences about the same fact, checked together.

    "This matches what you have written here" was sitting directly above a button reading "Publish
    your changes" — changes the same screen had just said did not exist. Read on their own each
    line looked right, which is why this reads them as a pair.
  */
  /*
    Two sentences about the same fact, checked together — and then the button that is not there.

    "This matches what you have written here" was sitting directly above "Publish your changes",
    changes the same screen had just said did not exist. Rewording it to "Publish again" was the
    second wrong answer: publishing increments the version server-side, so the button would
    manufacture an empty version of the record of what students were promised. There is nothing to
    publish, so there is no button.
  */
  check(`${L}: a published program in step says students already have it`,
    (await seen("program-review-in-step")) && (await seen("program-publish-unchanged")));
  check(`${L}: and offers no publish button that would write an empty version`,
    !(await seen("program-publish")));

  await p.locator('[data-testid="program-action-archive"]').click();
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(SHOTS, `${L}-confirm-archive.png`), fullPage: true });
  check(`${L}: archiving asks first`, await seen("program-confirm-archive"));
  check(`${L}: with a way to change your mind`, await seen("program-confirm-archive-cancel"));
  const confirm = await text("program-confirm-archive");
  check(`${L}: and says what happens`, /restore it later/i.test(confirm), confirm.slice(0, 140));
  await p.locator('[data-testid="program-confirm-archive-cancel"]').click();
  await p.waitForTimeout(200);
  check(`${L}: and nothing happened until it was confirmed`,
    JSON.stringify(await p.evaluate(() => window.__sent)) === "[]",
    JSON.stringify(await p.evaluate(() => window.__sent)));

  await show({
    screen: "studio",
    props: {
      program: detail({ status: "archived", version: 1, published: { version: 1 } }),
      draft: draft(), saveState: "clean", saveError: null, approved: true, busyAction: null, actionError: null,
    },
  }, "studio-archived");
  check(`${L}: an archived program is offered only restoring`,
    (await seen("program-action-restore")) && !(await seen("program-action-archive")) && !(await seen("program-action-unpublish")));
  check(`${L}: and says it must be restored before it can be published`,
    await seen("program-publish-blocked-archived"));

  /* --- a conflict from the server ---------------------------------------- */

  await show({
    screen: "studio",
    props: {
      program: detail(), draft: draft(), saveState: "clean", saveError: null, approved: true,
      busyAction: null,
      actionError: "This program is not published, so there is nothing to take down.",
    },
  }, "studio-conflict");
  check(`${L}: the server's own refusal is shown verbatim`,
    (await text("program-studio-action-failed")).includes("nothing to take down"),
    await text("program-studio-action-failed"));

  /* --- nothing threw ------------------------------------------------------ */
  check(`${L}: nothing threw on any screen`, errors.length === 0, errors[0] ?? "");
  const boom = await p.locator("#boom").count();
  check(`${L}: and no screen fell back to an error boundary`, boom === 0);

  await ctx.close();
  await browser.close();
}

rmSync(work, { recursive: true, force: true });
console.log(`\nScreenshots: ${SHOTS}`);
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
