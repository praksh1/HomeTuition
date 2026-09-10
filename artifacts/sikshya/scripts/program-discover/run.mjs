/**
 * The student's Programs surface, on a real screen, at a phone and at a laptop.
 *
 * ## What this proves
 *
 * That every state a student can be in on the Programs section is drawn distinctly (loading,
 * global-empty, no-match, first-load failure, pagination failure while cards still show, listed),
 * that the card carries only what the public API actually sends and no
 * price/rating/seat/enrolment/popularity fabrication, that a chip change is a filter change (the
 * screen submits it as a new query), that the details page renders the whole published snapshot
 * in order and never draws a Join button, that a visible ≥44 Search button sits beside the input,
 * that the reference disclosure is neutral for every value of `referenceSource`, and that at both
 * viewport sizes nothing overflows sideways or clips its own label.
 *
 * ## What it does not prove
 *
 * That the screen is wired to the API correctly. That is `app/(student)/index.tsx` and
 * `app/(student)/program/[id].tsx`, which are deliberately thin, and the real journey belongs in a
 * later end-to-end run against the API. This is the component-level pass — a real DOM at 390 and
 * 1440 with the props each state produces.
 *
 * Usage, from artifacts/sikshya:  node scripts/program-discover/run.mjs
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { bundleForBrowser } from "../bundle-for-browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const SHOTS = process.env.PROGRAM_SHOT_DIR || path.join(tmpdir(), "program-discover-shots");

let passed = 0, failed = 0; const failures = [];
const check = (n, ok, d = "") => {
  if (ok) { passed++; console.log(`  ok   ${n}`); }
  else { failed++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  FAIL ${n}${d ? ` — ${d}` : ""}`); }
};

const work = mkdtempSync(path.join(tmpdir(), "program-discover-"));
mkdirSync(SHOTS, { recursive: true });

const entry = path.join(work, "entry.jsx");
writeFileSync(
  entry,
  `
import React from "react";
import { createRoot } from "react-dom/client";
import ProgramDiscoverList from ${JSON.stringify(path.join(appRoot, "components", "programs", "ProgramDiscoverList.tsx"))};
import ProgramView from ${JSON.stringify(path.join(appRoot, "components", "programs", "ProgramView.tsx"))};
import { TeacherProgramsPanel } from ${JSON.stringify(path.join(appRoot, "components", "programs", "TeacherProgramsPanel.tsx"))};

window.__sent = [];
const record = (name) => (...args) => { window.__sent.push({ name, args }); };

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { window.__renderError = String(err && err.stack || err); }
  render() { return this.state.err ? React.createElement("pre", { id: "boom" }, String(this.state.err)) : this.props.children; }
}

let setScene = null;
let renders = 0;

// The list owns the query and the chosen type inside the app; the harness holds them so a chip
// press or a search-submit is reflected on screen. A chip tap forwards to the recorded onSubmit
// so the test can see the filter travel the same way the app runs it.
function ListHost(props) {
  const [query, setQuery] = React.useState(props.query ?? "");
  const [type, setType] = React.useState(props.chosenType ?? "all");
  React.useEffect(() => { setQuery(props.query ?? ""); setType(props.chosenType ?? "all"); }, [props.query, props.chosenType]);
  return React.createElement(ProgramDiscoverList, {
    ...props,
    query, onQueryChange: setQuery,
    chosenType: type,
    onTypeChange: (next) => { setType(next); window.__sent.push({ name: "onTypeChange", args: [next] }); },
    onSubmit: record("onSubmit"),
  });
}

function Harness() {
  const [scene, set] = React.useState({ screen: "list", props: { programs: [], initialLoad: false, initialError: null, paginationError: null, loadingMore: false, hasMore: false } });
  setScene = set;
  const common = { onRetry: record("onRetry"), onLoadMore: record("onLoadMore"), onOpen: record("onOpen"), onBack: record("onBack"), onOpenTeacher: record("onOpenTeacher") };
  const sceneKey = JSON.stringify([scene.screen, Object.keys(scene.props ?? {})]) + String(renders);
  let element = null;
  if (scene.screen === "list") element = React.createElement(ListHost, { ...common, ...scene.props });
  if (scene.screen === "view") element = React.createElement(ProgramView, { ...common, ...scene.props });
  if (scene.screen === "profile") element = React.createElement(TeacherProgramsPanel, {
    ...scene.props,
    onRetry: record("onRetry"),
    onLoadMore: record("onLoadMore"),
    onOpen: record("onOpen"),
  });
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
  `<!doctype html><html><head><meta charset="utf-8"><title>program discover</title>
<style>body{margin:0;font-family:system-ui,sans-serif}</style></head>
<body><div id="root"></div><script src="bundle.js"></script></body></html>`,
);

/* ------------------------------------------------------------------------- */

const summary = (over = {}) => ({
  id: 12, type: "school_subject", version: 1, publishedAt: "2026-09-05T09:00:00Z",
  teacher: { id: 42, name: "Anjali Rai" },
  title: "Grade 10 Mathematics, term by term",
  summary: "A term of Grade 10 mathematics, worked through week by week together.",
  outcome: "Students can work through a whole past paper with support.",
  intendedLearner: "Students in Grade 10 preparing for the board examination",
  startingLevel: "Comfortable with Grade 9 arithmetic",
  teachingLanguage: "Nepali and English",
  referenceName: "NEB Mathematics syllabus", referenceSource: "teacher_supplied",
  moduleCount: 6, ...over,
});

const detail = (over = {}) => ({
  ...summary(),
  prerequisites: null, equipment: null,
  modules: [
    { title: "Where we start", outcome: "Know what the first lesson covers and why it comes first." },
    { title: "Working with fractions", outcome: "Add, subtract, multiply and divide fractions confidently." },
    { title: "Algebra to the exam standard", outcome: "Solve algebra questions at the level the board asks." },
  ], ...over,
});

const list = () => [
  summary({ id: 12 }),
  summary({ id: 13, type: "practical_skill", teacher: { id: 43, name: "Dipendra Shrestha" },
    title: "Beginner guitar from the first chord",
    summary: "Six weeks of playing songs on acoustic guitar together.",
    outcome: "Play three songs from memory with clean chord changes.",
    startingLevel: "Never held a guitar before",
    intendedLearner: null }),
  summary({ id: 14, type: "language", teacher: { id: 44, name: "Sujata Karki" },
    title: "Everyday spoken Nepali for new arrivals",
    summary: "Ordinary sentences you need in Kathmandu the first week.",
    outcome: "Ask for directions, order food, greet a neighbour." }),
];

const listState = (over = {}) => ({
  programs: [], initialLoad: false, initialError: null, paginationError: null,
  loadingMore: false, hasMore: false, ...over,
});

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
    const boom = await p.evaluate(() => window.__renderError ?? null);
    if (boom) check(`${L}: ${shot ?? scene.screen} renders`, false, String(boom).slice(0, 200));
    if (shot) await p.screenshot({ path: path.join(SHOTS, `${L}-${shot}.png`), fullPage: true });
  };
  const seen = (id) => p.locator(`[data-testid="${id}"]`).count().then((n) => n > 0);
  const text = (id) => p.locator(`[data-testid="${id}"]`).first().innerText().catch(() => "");
  const body = () => p.locator("body").innerText().catch(() => "");
  const overflow = () =>
    p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const smallTargets = () =>
    p.evaluate(() =>
      [...document.querySelectorAll('[role="button"], [role="link"], input, textarea')]
        .filter((el) => el.getBoundingClientRect().height > 0)
        .filter((el) => el.getBoundingClientRect().height < 44)
        .map((el) => `${el.getAttribute("data-testid") ?? el.tagName}:${Math.round(el.getBoundingClientRect().height)}`));

  /* ---------------------------------------------------------- list states */

  console.log(`\n[${L}] Discover: Programs`);

  await show({
    screen: "list",
    props: listState({ initialLoad: true }),
  }, "list-loading");
  check(`${L}: loading is skeletons, not a spinner`, await seen("program-discover-loading"));
  check(`${L}: and never the empty state`, !(await seen("program-discover-empty")));

  await show({ screen: "list", props: listState() }, "list-empty");
  check(`${L}: no programs at all reads as "no programs yet"`, await seen("program-discover-empty"));
  const emptyText = await text("program-discover-empty");
  check(`${L}: and says a program is different from a single class`,
    /different from a single class/i.test(emptyText), emptyText.slice(0, 160));

  await show({
    screen: "list",
    props: listState({ initialError: "Fadko could not reach the server." }),
  }, "list-failed");
  check(`${L}: a first-load failure says so`, await seen("program-discover-failure"));
  check(`${L}: and is never drawn as "no programs yet"`, !(await seen("program-discover-empty")),
    "a failed load rendered as empty tells a student their world is smaller than it is");

  await show({
    screen: "list",
    props: listState({ programs: list(), hasMore: true }),
  }, "list-populated");
  check(`${L}: every published program is on screen`,
    (await seen("program-card-12")) && (await seen("program-card-13")) && (await seen("program-card-14")));
  check(`${L}: with the teacher name on each card`,
    /Anjali Rai/i.test(await body()) && /Dipendra Shrestha/i.test(await body()));
  check(`${L}: and the type is shown as a chip`,
    /Practical skill/i.test(await body()) && /Language/i.test(await body()) && /School subject/i.test(await body()));
  check(`${L}: with a "Show more" while the server says there is more`, await seen("program-discover-more"));
  check(`${L}: a visible Search button sits beside the input`, await seen("program-discover-search-submit"));

  const wholeList = await body();
  for (const invented of ["NPR", "Rs.", "rating", "star rating", "5 stars", "students enrolled", "enrolled", "Popular", "Top pick", "Available now", "earned", "reviews", "seats", "spots"]) {
    check(`${L}: the list carries no ${invented}`, !wholeList.toLowerCase().includes(invented.toLowerCase()),
      wholeList.slice(0, 160).replace(/\n/g, " | "));
  }
  check(`${L}: the list does not scroll sideways`, (await overflow()) <= 1, `overflow ${await overflow()}px`);
  check(`${L}: no control on the list is below the touch floor`,
    (await smallTargets()).length === 0, (await smallTargets()).join(", "));

  /* --------------------------------------------- programs on a teacher profile */

  console.log(`\n[${L}] Published programs on a teacher profile`);

  await show({
    screen: "profile",
    props: { list: { rows: [], nextCursor: null }, state: "ready", loadingMore: false },
  });
  check(`${L}: a teacher with no published programs gets no empty marketing section`,
    !(await seen("teacher-programs-section")));

  await show({
    screen: "profile",
    props: { list: { rows: [], nextCursor: null }, state: "failed", loadingMore: false },
  }, "profile-failed");
  check(`${L}: a failed request is not presented as no programs`,
    /Programs couldn't load/i.test(await body()));

  await show({
    screen: "profile",
    props: { list: { rows: list(), nextCursor: "next-page" }, state: "ready", loadingMore: false },
  }, "profile-programs");
  check(`${L}: the profile shows each published snapshot`,
    (await seen("teacher-program-12")) && (await seen("teacher-program-13")) && (await seen("teacher-program-14")));
  check(`${L}: the profile offers another page only when the server has one`,
    await seen("teacher-programs-more"));
  await p.evaluate(() => { window.__sent = []; });
  await p.locator('[data-testid="teacher-program-12"]').click();
  const profileOpen = await p.evaluate(() => window.__sent);
  check(`${L}: a profile card opens the exact program`,
    profileOpen.some((event) => event.name === "onOpen" && event.args[0] === 12), JSON.stringify(profileOpen));
  check(`${L}: the teacher-profile section does not scroll sideways`,
    (await overflow()) <= 1, `overflow ${await overflow()}px`);
  check(`${L}: every profile-program control reaches the touch floor`,
    (await smallTargets()).length === 0, (await smallTargets()).join(", "));

  // Return to the populated Discover list before its card and interaction checks continue.
  await show({ screen: "list", props: listState({ programs: list(), hasMore: true }) });

  /* -------------- intended-learner rendered when the API sends it, absent otherwise */

  check(`${L}: "who it is for" is shown on cards that carry it`,
    await seen("program-card-12-learner"));
  check(`${L}: and simply omitted on cards that do not`,
    !(await seen("program-card-13-learner")),
    "guitar card had null intendedLearner and must not invent one");

  /* ---------------------------------------------------------- chip means fetch */

  console.log(`\n[${L}] Chip taps and search submissions`);

  await p.evaluate(() => { window.__sent = []; });
  await p.locator('[data-testid="program-discover-chip-practical_skill"]').click();
  await p.waitForTimeout(50);
  const sentAfterChip = await p.evaluate(() => window.__sent);
  check(`${L}: a chip tap fires onTypeChange, and the parent will re-fetch`,
    sentAfterChip.some((e) => e.name === "onTypeChange" && e.args[0] === "practical_skill"),
    JSON.stringify(sentAfterChip).slice(0, 200));

  /* --------------------------------------------- visible search submits the query */

  await show({ screen: "list", props: listState({ programs: list(), query: "guitar" }) });
  await p.evaluate(() => { window.__sent = []; });
  await p.locator('[data-testid="program-discover-search-submit"]').click();
  await p.waitForTimeout(50);
  const sentAfterSubmit = await p.evaluate(() => window.__sent);
  check(`${L}: the Search button calls onSubmit with the current text`,
    sentAfterSubmit.some((e) => e.name === "onSubmit" && e.args[0] === "guitar"),
    JSON.stringify(sentAfterSubmit).slice(0, 200));

  /* --------------------------------------------- no-match versus empty distinguished */

  await show({
    screen: "list",
    props: listState({ query: "guaranteed100percent" }),
  }, "list-nomatch-query");
  check(`${L}: server returned [] with an active query is "no matching"`, await seen("program-discover-nomatch"));
  check(`${L}: and never the global empty state`, !(await seen("program-discover-empty")));
  check(`${L}: which quotes the query`,
    /guaranteed100percent/i.test(await text("program-discover-nomatch")));

  await show({
    screen: "list",
    props: listState({ chosenType: "practical_skill" }),
  }, "list-nomatch-filter");
  check(`${L}: server returned [] with an active type filter is "no matching"`,
    await seen("program-discover-nomatch"));
  check(`${L}: and never the global empty state`, !(await seen("program-discover-empty")));

  /* --------------------- pagination failure keeps successful cards on screen */

  await show({
    screen: "list",
    props: listState({
      programs: list(),
      hasMore: true,
      paginationError: "Fadko could not load the next page. Check your connection and try again.",
    }),
  }, "list-more-error");
  check(`${L}: the already-loaded cards stay on screen`,
    (await seen("program-card-12")) && (await seen("program-card-13")) && (await seen("program-card-14")));
  check(`${L}: a pagination failure is drawn beside "Show more"`,
    await seen("program-discover-more-error"));
  check(`${L}: never as the whole-list failure card`,
    !(await seen("program-discover-failure")),
    "a pagination failure that hides successful cards is Codex correction round 1, item 4");
  check(`${L}: with a Try again beside it`, await seen("program-discover-more-retry"));

  /* ---------------------------------------------------------- details */

  console.log(`\n[${L}] A program in full`);

  await show({ screen: "view", props: { program: detail() } }, "view-full");
  check(`${L}: the title is at the top`, /Grade 10 Mathematics/i.test(await text("program-view-title")));
  check(`${L}: the outcome sits under it`, /past paper/i.test(await text("program-view-outcome")));
  check(`${L}: who it is for is shown`, await seen("program-view-intended-learner"));
  check(`${L}: the starting level is shown`, await seen("program-view-starting-level"));
  check(`${L}: the teaching language is shown`, await seen("program-view-language"));
  check(`${L}: the reference is shown with a non-endorsement`,
    (await seen("program-view-reference"))
      && /Fadko has not independently verified or endorsed it/i.test(await text("program-view-reference-disclosure")));
  check(`${L}: and never as "teacher supplied", even for a teacher_supplied source`,
    !/teacher supplied/i.test(await text("program-view-reference-disclosure")),
    await text("program-view-reference-disclosure"));

  // Same neutral disclosure for an `official` reference — no false provenance claim.
  await show({ screen: "view", props: { program: detail({ referenceSource: "official", referenceName: "IOE entrance framework" }) } });
  check(`${L}: an official reference uses the same neutral disclosure`,
    /Fadko has not independently verified or endorsed it/i.test(await text("program-view-reference-disclosure")));

  // Back to the full detail for the remaining checks.
  await show({ screen: "view", props: { program: detail() } });

  check(`${L}: the learning path has every step in order`,
    (await seen("program-view-module-0")) && (await seen("program-view-module-1")) && (await seen("program-view-module-2")));
  const step0 = await text("program-view-module-0");
  const step2 = await text("program-view-module-2");
  check(`${L}: step 1 comes before step 3`,
    /STEP 1/i.test(step0) && /STEP 3/i.test(step2) && /Where we start/i.test(step0) && /Algebra/i.test(step2));
  check(`${L}: the teacher's name is on the page`, /Anjali Rai/i.test(await body()));
  check(`${L}: with a way to open their profile`, await seen("program-view-teacher-link"));
  check(`${L}: no Join, Buy, Enrol, Reserve or Pay button anywhere`,
    !/(Join now|Buy|Enrol|Reserve|Pay now|Purchase|Book now)/i.test(await body()),
    (await body()).slice(0, 200).replace(/\n/g, " | "));
  check(`${L}: an honest "not open yet" notice is on the page`,
    await seen("program-view-not-open"));
  check(`${L}: the Back to Discover control is drawn`, await seen("program-view-back"));

  const wholeView = await body();
  for (const invented of ["NPR", "Rs.", "rating", "star rating", "5 stars", "students enrolled", "seats", "spots", "reviews", "Popular", "Available now", "earned", "%"]) {
    check(`${L}: the details page carries no ${invented}`, !wholeView.toLowerCase().includes(invented.toLowerCase()),
      wholeView.slice(0, 160).replace(/\n/g, " | "));
  }

  check(`${L}: the details page does not scroll sideways`, (await overflow()) <= 1, `overflow ${await overflow()}px`);
  check(`${L}: no control on the details page is below the touch floor`,
    (await smallTargets()).length === 0, (await smallTargets()).join(", "));

  /* ---------------------------------------------------------- reference disclosure */

  await show({ screen: "view", props: { program: detail({ referenceName: null }) } });
  check(`${L}: a program with no reference gets no reference block at all`,
    !(await seen("program-view-reference")));

  /* ---------------------------------------------------------- long content */

  await show({
    screen: "view", props: { program: detail({
      title: "एक कक्षा गणित पूर्ण पाठ्यक्रम, हप्ता हप्ता, विद्यार्थीलाई पूर्ण तयारीका लागि",
      summary: "यो पाठ्यक्रम कक्षा १० को गणितलाई हप्ता हप्तामा बुझ्नको लागि बनाइएको हो।",
      outcome: "विद्यार्थीहरूले पूर्ण पुरानो प्रश्नपत्र समाधान गर्न सक्नेछन्।",
    }) },
  });
  check(`${L}: long Nepali content still fits without scrolling sideways`,
    (await overflow()) <= 1, `overflow ${await overflow()}px`);

  check(`${L}: nothing threw on any screen`, errors.length === 0, errors.join(" || ").slice(0, 200));
  await browser.close();
}

console.log(`\nScreenshots: ${SHOTS}\n\n${passed} passed, ${failed} failed`);
if (failures.length) { console.log(""); for (const f of failures) console.log(`  - ${f}`); }
rmSync(work, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
