/**
 * Every decision this file exports, exercised. Nothing here draws a screen; that is
 * `scripts/program-discover/run.mjs`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DISCOVER_TABS,
  appendPage,
  cardFromDetail,
  cardFromSummary,
  localMatches,
  localTypeMatches,
  missingOptional,
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

test("Discover has exactly three views, in the order Programs, Single classes, Teachers", () => {
  assert.deepEqual(DISCOVER_TABS.map((t) => t.view), ["programs", "classes", "teachers"]);
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

test("the detail card includes the intended learner; the summary card does not (the API does not send it)", () => {
  assert.equal(cardFromSummary(row()).intendedLearnerLine, null);
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

test("a teacher-supplied reference is shown with an explicit non-endorsement", () => {
  const block = referenceBlock(full({ referenceName: "NEB Mathematics syllabus" }));
  assert.equal(block?.name, "NEB Mathematics syllabus");
  assert.match(block?.disclosure ?? "", /Fadko does not check or endorse/i);
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

test("merging pages deduplicates by id and keeps order", () => {
  const first = { rows: [row({ id: 1 }), row({ id: 2 })], nextCursor: "a" };
  const second = { rows: [row({ id: 2, title: "Republished" }), row({ id: 3 })], nextCursor: null };
  const merged = appendPage(first, second);
  assert.deepEqual(merged.rows.map((r) => r.id), [1, 2, 3]);
  // The already-loaded row keeps its earlier content — the point is not to shuffle rows across pages.
  assert.equal(merged.rows[1].title, row({ id: 2 }).title);
  assert.equal(merged.nextCursor, null);
});
