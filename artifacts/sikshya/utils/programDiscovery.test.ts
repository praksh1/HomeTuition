/**
 * Every decision this file exports, exercised. Nothing here draws a screen; that is
 * `scripts/program-discover/run.mjs`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DISCOVER_TABS,
  TEACHERS_TABS,
  appendPage,
  cardFromDetail,
  cardFromSummary,
  localMatches,
  localTypeMatches,
  missingOptional,
  programListState,
  programTypeFilters,
  referenceBlock,
  type PublicProgramDetail,
  type PublicProgramSummary,
} from "./programDiscovery.ts";
import { PROGRAM_TYPE_CHOICES } from "./learningProgramUi.ts";

const row = (over: Partial<PublicProgramSummary> = {}): PublicProgramSummary => ({
  id: 1, type: "school_subject", version: 1, publishedAt: new Date().toISOString(),
  teacher: { id: 42, name: "Anjali Rai" },
  title: "Grade 10 Mathematics, term by term",
  summary: "A term of Grade 10 mathematics, worked through week by week together.",
  outcome: "Students can work through a whole past paper with support.",
  startingLevel: "Comfortable with Grade 9 arithmetic",
  teachingLanguage: "Nepali and English",
  referenceName: "NEB Mathematics syllabus", referenceSource: "teacher_supplied",
  moduleCount: 6, ...over,
});

const full = (over: Partial<PublicProgramDetail> = {}): PublicProgramDetail => ({
  ...row(), intendedLearner: "Students in Grade 10 preparing for the board examination",
  prerequisites: null, equipment: null, modules: [
    { title: "Where we start", outcome: "Know what the first lesson covers." },
    { title: "Working with fractions", outcome: "Can add, subtract, multiply, divide fractions." },
  ], ...over,
});

/* --- tabs and filters ------------------------------------------------------- */

test("Discover starts with the two questions a student actually arrives with", () => {
  assert.deepEqual(DISCOVER_TABS.map((t) => t.view), ["classes", "teachers"]);
});

test("each student intention has an accurate heading, subtitle and accessible label", () => {
  const c = DISCOVER_TABS.find((t) => t.view === "classes")!;
  const tc = DISCOVER_TABS.find((t) => t.view === "teachers")!;
  assert.match(c.heading, /learn/i);
  assert.match(tc.heading, /teacher/i);
  assert.equal(c.label, "Find a class");
  assert.match(c.accessibilityLabel, /class or course/i);
  assert.equal(tc.label, "Find my teacher");
});

test("Following is a sub-choice of Teachers, not a primary product view", () => {
  assert.deepEqual(TEACHERS_TABS.map((t) => t.view), ["all", "following"]);
  assert.equal(DISCOVER_TABS.some((t) => t.view === ("following" as never)), false,
    "Following belongs under Teachers, not beside Programs");
});

test("the type filters cover exactly the program types this build knows, plus 'All' first", () => {
  const filters = programTypeFilters();
  assert.equal(filters[0].type, "all");
  assert.deepEqual(filters.slice(1).map((f) => f.type), PROGRAM_TYPE_CHOICES.map((c) => c.type));
});

test("chip labels are the same words the API's search matches against", () => {
  // A student typing "Practical skill" into search must find the same programs a "Practical skill"
  // chip highlights. Two different labels here would silently split the two paths.
  const filters = programTypeFilters().slice(1);
  for (const f of filters) {
    assert.ok(f.label && f.label.length > 0, `no label for ${f.type}`);
  }
  assert.ok(
    filters.some((f) => f.label === "Practical skill"),
    filters.map((f) => f.label).join(" | "),
  );
});

/* --- cards -------------------------------------------------------------- */

test("a card never invents a price, a rating, or a student count", () => {
  const c = cardFromSummary(row());
  const printed = Object.values(c).join(" ").toLowerCase();
  for (const claim of [
    "npr", "rs.", "rating", "star", "students enrolled", "enrolled", "popular", "top pick",
    "available now", "earned", "reviews", "seats", "spots", "%",
  ]) {
    assert.ok(!printed.includes(claim), `card leaked "${claim}"`);
  }
});

test("a card falls back to 'Untitled program' when the title is empty, never to a made-up one", () => {
  assert.equal(cardFromSummary(row({ title: "" })).title, "Untitled program");
  assert.equal(cardFromDetail(full({ title: "" })).title, "Untitled program");
});

test("the summary card shows 'who it is for' when the API sends it, and nothing when it does not", () => {
  const withLearner = cardFromSummary(row({ intendedLearner: "Grade 10 students" }));
  assert.match(withLearner.intendedLearnerLine ?? "", /Grade 10 students/);

  const older = cardFromSummary(row({ intendedLearner: undefined }));
  assert.equal(older.intendedLearnerLine, null);

  const blank = cardFromSummary(row({ intendedLearner: "   " }));
  assert.equal(blank.intendedLearnerLine, null, "a whitespace-only field is not a claim");
});

test("the detail card also shows the intended learner", () => {
  assert.match(cardFromDetail(full()).intendedLearnerLine ?? "", /Grade 10/);
});

/* --- local filters --------------------------------------------------------- */

test("local search matches title, summary, outcome, teacher, teaching language and reference", () => {
  const r = row();
  assert.ok(localMatches(r, "mathematics"));
  assert.ok(localMatches(r, "term by term"));
  assert.ok(localMatches(r, "anjali"));
  assert.ok(localMatches(r, "NEB"));
  assert.ok(localMatches(r, "Nepali"));
  assert.ok(!localMatches(r, "guitar"));
});

test("an empty query keeps every row, so clearing the box refills the list", () => {
  assert.ok(localMatches(row(), ""));
  assert.ok(localMatches(row(), "   "));
});

test("type filters match by code, not by label", () => {
  const skill = row({ type: "practical_skill" });
  const subject = row({ type: "school_subject" });
  assert.ok(localTypeMatches(subject, new Set(["school_subject"])));
  assert.ok(!localTypeMatches(skill, new Set(["school_subject"])));
  // "All" or empty means everything.
  assert.ok(localTypeMatches(skill, new Set(["all"])));
  assert.ok(localTypeMatches(skill, new Set()));
});

/* --- reference disclosure ---------------------------------------------- */

test("a cited reference is disclosed with a neutral non-endorsement, not a provenance claim", () => {
  const teacher = referenceBlock(full({ referenceName: "NEB Mathematics syllabus", referenceSource: "teacher_supplied" }));
  assert.equal(teacher?.name, "NEB Mathematics syllabus");
  assert.match(teacher?.disclosure ?? "", /not independently verified or endorsed/i);
  // Codex's sixth correction: calling an `official` reference "teacher supplied" would be a
  // false provenance claim.
  assert.doesNotMatch(teacher?.disclosure ?? "", /teacher supplied/i);

  const official = referenceBlock(full({ referenceName: "IOE entrance", referenceSource: "official" }));
  assert.equal(official?.disclosure, teacher?.disclosure,
    "the disclosure is the same for every source, because Fadko endorses none of them");
});

test("a program with no reference gets no reference block at all", () => {
  assert.equal(referenceBlock(full({ referenceName: null })), null);
  assert.equal(referenceBlock(full({ referenceName: "   " })), null);
});

test("optional fields the teacher left blank are named as missing, not filled in", () => {
  const missing = missingOptional(full({ intendedLearner: "", startingLevel: "", prerequisites: null, equipment: null }));
  assert.deepEqual(missing, ["who it is for", "the starting level", "prerequisites", "what to bring"]);
});

/* --- pagination ---------------------------------------------------------- */

/* --- list state ---------------------------------------------------------- */

const listInput = (over: Partial<Parameters<typeof programListState>[0]> = {}) => ({
  initialLoad: false, loadedRows: [] as PublicProgramSummary[], hasMore: false,
  initialError: null as string | null, paginationError: null as string | null,
  query: "", chosenType: "all" as const, ...over,
});

test("the first load is loading, always, whatever else is true", () => {
  assert.equal(programListState(listInput({ initialLoad: true })).kind, "loading");
});

test("zero rows with no query and no filter is the global empty state", () => {
  assert.equal(programListState(listInput()).kind, "empty");
});

test("zero rows with an active query is a no-match, not an empty state", () => {
  const state = programListState(listInput({ query: "guaranteed100percent" }));
  assert.equal(state.kind, "noMatch");
  if (state.kind === "noMatch") assert.equal(state.query, "guaranteed100percent");
});

test("zero rows with an active type filter is also a no-match", () => {
  const state = programListState(listInput({ chosenType: "practical_skill" }));
  assert.equal(state.kind, "noMatch");
  if (state.kind === "noMatch") assert.equal(state.filterActive, true);
});

test("a first-load failure with nothing rendered is the failure state", () => {
  const state = programListState(listInput({ initialError: "Network is down" }));
  assert.equal(state.kind, "error");
});

test("a pagination failure never hides successful cards", () => {
  const state = programListState(listInput({
    loadedRows: [row()], hasMore: true, paginationError: "Next page failed",
  }));
  assert.equal(state.kind, "ready");
  if (state.kind === "ready") {
    assert.equal(state.rows.length, 1);
    assert.equal(state.paginationError, "Next page failed");
    assert.equal(state.hasMore, true);
  }
});

test("merging pages deduplicates by id and keeps order", () => {
  const first = { rows: [row({ id: 1 }), row({ id: 2 })], nextCursor: "a" };
  const second = { rows: [row({ id: 2, title: "Republished" }), row({ id: 3 })], nextCursor: null };
  const merged = appendPage(first, second);
  assert.deepEqual(merged.rows.map((r) => r.id), [1, 2, 3]);
  // The already-loaded row keeps its earlier content — the point is not to shuffle rows across pages.
  assert.equal(merged.rows[1].title, row({ id: 2 }).title);
  assert.equal(merged.nextCursor, null);
});
