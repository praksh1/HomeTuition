import assert from "node:assert/strict";
import test from "node:test";

import { PROGRAM_TYPES, validateLearningProgramForPublish, type LearningProgramDraft } from "./learningPrograms.ts";
import {
  draftFrom,
  hasUnpublishedChanges,
  readProgramType,
  readReferenceSource,
  publishedSnapshotFor,
  readSnapshot,
  readStatus,
  snapshotOf,
  transition,
} from "./learningProgramState.ts";

/**
 * The rules about authority and honesty, exercised without a database.
 *
 * `learningPrograms.test.ts` next door covers the publish contract itself. This covers what the
 * routes rest on: who may move a program where, what a student is served, and whether an edit made
 * after publication can reach them. All of it is a pure function of its arguments, which is the
 * only reason any of it gets run — a rule that needs a browser and a live database to exercise is
 * a rule nobody exercises.
 */

/* --- reading what a client sent ------------------------------------------ */

test("every program type this build supports is readable, and nothing else is", () => {
  for (const type of PROGRAM_TYPES) {
    assert.equal(readProgramType(type), type, `${type} should be readable`);
  }
  assert.equal(PROGRAM_TYPES.length, 5, "five types: school, skill, language, exam, custom");
  for (const wrong of ["driving_lesson", "", "SCHOOL_SUBJECT", 3, null, undefined, {}]) {
    assert.equal(readProgramType(wrong), null, `${JSON.stringify(wrong)} is not a program type`);
  }
});

test("a reference source is refused rather than defaulted", () => {
  assert.equal(readReferenceSource("official"), "official");
  assert.equal(readReferenceSource("teacher_supplied"), "teacher_supplied");
  assert.equal(readReferenceSource("none"), "none");
  /*
    Both directions of the same danger. Defaulting to `none` would erase a teacher's real citation;
    defaulting to `official` would have Fadko endorsing a syllabus nobody checked.
  */
  assert.equal(readReferenceSource("endorsed"), null);
  assert.equal(readReferenceSource(undefined), null);
});

test("only the three real statuses are readable", () => {
  assert.equal(readStatus("draft"), "draft");
  assert.equal(readStatus("published"), "published");
  assert.equal(readStatus("archived"), "archived");
  assert.equal(readStatus("deleted"), null);
  assert.equal(readStatus("all"), null);
});

/* --- the state machine ---------------------------------------------------- */

test("a draft may be saved, published, archived — and deleted only while it has never been public", () => {
  assert.deepEqual(transition("draft", "save"), { ok: true, next: "draft", bumpsVersion: false });
  assert.deepEqual(transition("draft", "publish"), { ok: true, next: "published", bumpsVersion: true });
  assert.deepEqual(transition("draft", "archive"), { ok: true, next: "archived", bumpsVersion: false });
  assert.deepEqual(transition("draft", "delete"), { ok: true, next: null, bumpsVersion: false });
});

test("a published program can still be edited, and the edit changes nothing a student sees", () => {
  // The draft columns are the teacher's workspace. Refusing this would mean unpublishing — taking
  // the program off the site — in order to fix a typo in it.
  const move = transition("published", "save");
  assert.equal(move.ok && move.next, "published");
  assert.equal(move.ok && move.bumpsVersion, false);
});

test("re-publishing is a new version, not a silent overwrite", () => {
  const move = transition("published", "publish");
  assert.equal(move.ok && move.bumpsVersion, true, "a student must be able to tell it changed");
});

test("restoring an archived program returns it to draft, never straight to published", () => {
  const move = transition("archived", "restore");
  assert.equal(move.ok && move.next, "draft",
    "restoring says 'I want this again', not 'put it in front of students unread'");
});

test("an archived program refuses edits and publication, and says which it is", () => {
  const save = transition("archived", "save");
  assert.equal(save.ok, false);
  assert.equal(!save.ok && save.code, "archived");
  assert.match(!save.ok ? save.reason : "", /restore/i, "the refusal names the way out");

  const publish = transition("archived", "publish");
  assert.equal(!publish.ok && publish.code, "archived");
});

test("every refusal names its own situation rather than returning one 'not allowed'", () => {
  // `.agents/memory/refusals-must-name-their-reason.md`: a teacher told "that is not allowed" goes
  // looking for a permission problem when what they have is an archived program.
  const codes = [
    transition("draft", "unpublish"),
    transition("draft", "restore"),
    transition("published", "delete"),
    transition("archived", "save"),
  ].map((r) => (r.ok ? "ok" : r.code));
  assert.deepEqual(codes, ["not-published", "not-archived", "not-draft", "archived"]);
  assert.equal(new Set(codes).size, 4, "four situations, four answers");
});

test("a draft that was once published is kept rather than erased", () => {
  const move = transition("draft", "delete", { hasEverPublished: true });
  assert.equal(move.ok, false);
  assert.equal(!move.ok && move.code, "was-published");
  assert.match(!move.ok ? move.reason : "", /archive/i);
});

test("archiving twice is not an error", () => {
  assert.equal(transition("archived", "archive").ok, true);
});

/* --- rows in, drafts out -------------------------------------------------- */

const emptyRow = {
  type: "custom",
  title: null,
  summary: null,
  outcome: null,
  intendedLearner: null,
  startingLevel: null,
  teachingLanguage: null,
  prerequisites: null,
  equipment: null,
  referenceName: null,
  referenceSource: "none",
};

test("an unfinished draft becomes exactly the list of things left to write", () => {
  const draft = draftFrom(emptyRow, []);
  const issues = validateLearningProgramForPublish(draft);
  const fields = issues.map((i) => i.field).sort();
  assert.deepEqual(fields, [
    "intendedLearner", "modules", "outcome", "startingLevel", "summary", "teachingLanguage", "title",
  ]);
  assert.ok(issues.every((i) => i.code === "required"), "every one is missing, not malformed");
});

test("modules come back in stored order however they were read", () => {
  const draft = draftFrom(emptyRow, [
    { position: 2, title: "Third", outcome: "c", description: null, practicePrompt: null },
    { position: 0, title: "First", outcome: "a", description: null, practicePrompt: null },
    { position: 1, title: "Second", outcome: "b", description: null, practicePrompt: null },
  ]);
  assert.deepEqual(draft.modules.map((m) => m.title), ["First", "Second", "Third"]);
});

test("a type nobody recognises survives to the validator, which refuses it", () => {
  // A row edited by hand in the database must not become publishable by going round the routes.
  const draft = draftFrom({ ...emptyRow, type: "driving_lesson" }, []);
  const issues = validateLearningProgramForPublish(draft);
  assert.ok(issues.some((i) => i.field === "type" && i.code === "invalid"));
});

/* --- the four pilots, and the fifth type ---------------------------------- */

const modules = [
  { title: "Where we start", outcome: "Know what the first lesson covers and why." },
  { title: "Practising it", outcome: "Work through examples with feedback each week." },
];

const pilot = (over: Partial<LearningProgramDraft>): LearningProgramDraft => ({
  type: "custom",
  title: "A programme with a long enough name",
  summary: "What this covers, who it suits, and how the weeks are spent together.",
  outcome: "Students can work through the material with support.",
  intendedLearner: "Anyone starting out",
  startingLevel: "Beginner",
  teachingLanguage: "Nepali and English",
  referenceSource: "none",
  modules,
  ...over,
});

test("the four Nepal pilots publish, and so does a custom program", () => {
  const pilots: Record<string, LearningProgramDraft> = {
    "Grade 10 Mathematics": pilot({
      type: "school_subject",
      title: "Grade 10 Mathematics, term by term",
      referenceName: "SEE Mathematics syllabus",
      referenceSource: "teacher_supplied",
    }),
    "Beginner guitar": pilot({
      type: "practical_skill",
      title: "Beginner guitar from the first chord",
      equipment: "Any acoustic guitar",
    }),
    "Spoken English": pilot({
      type: "language",
      title: "Spoken English for everyday life",
      startingLevel: "Can read simple English",
    }),
    "Engineering registration exam": pilot({
      type: "exam_preparation",
      title: "Engineering registration exam preparation",
      referenceName: "Nepal Engineering Council registration examination",
      referenceSource: "teacher_supplied",
    }),
    "Something else": pilot({ type: "custom", title: "Study skills for first-year students" }),
  };
  for (const [name, draft] of Object.entries(pilots)) {
    assert.deepEqual(validateLearningProgramForPublish(draft), [], `${name} should publish`);
  }
});

test("an exam program must name its exam, and may not promise a result", () => {
  const nameless = pilot({ type: "exam_preparation", referenceSource: "none" });
  assert.ok(validateLearningProgramForPublish(nameless).some(
    (i) => i.field === "referenceName" && i.code === "required",
  ), "never silently infer which exam a teacher meant");

  const promising = pilot({
    type: "exam_preparation",
    referenceName: "Nepal Engineering Council registration examination",
    referenceSource: "teacher_supplied",
    outcome: "Students are guaranteed to pass the registration examination.",
  });
  assert.ok(validateLearningProgramForPublish(promising).some((i) => i.code === "unsupported_claim"));
});

/* --- the snapshot, and what a student is served --------------------------- */

test("a snapshot carries the promise and has nowhere to put an invented number", () => {
  const snapshot = snapshotOf(pilot({}), 1);
  const keys = Object.keys(snapshot).sort();
  assert.deepEqual(keys, [
    "equipment", "intendedLearner", "modules", "outcome", "prerequisites", "referenceName",
    "referenceSource", "startingLevel", "summary", "teachingLanguage", "title", "type", "version",
  ]);
  for (const forbidden of ["rating", "reviews", "students", "enrolled", "popular", "verified", "price"]) {
    assert.ok(!keys.includes(forbidden), `a snapshot must not carry ${forbidden}`);
  }
});

test("a teacher's declared reference source is carried through, never promoted", () => {
  const snapshot = snapshotOf(
    pilot({ referenceName: "SEE Mathematics syllabus", referenceSource: "teacher_supplied" }),
    1,
  );
  assert.equal(snapshot.referenceSource, "teacher_supplied",
    "a teacher saying they follow a syllabus is not Fadko saying it is endorsed");
});

test("module order is the array order, renumbered densely from zero", () => {
  const snapshot = snapshotOf(pilot({}), 3);
  assert.deepEqual(snapshot.modules.map((m) => m.position), [0, 1]);
  assert.equal(snapshot.modules[0]?.title, "Where we start");
});

test("a snapshot round-trips", () => {
  const snapshot = snapshotOf(pilot({}), 2);
  assert.deepEqual(readSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
});

test("a stored snapshot is read back in position order even if it was written out of order", () => {
  const snapshot = snapshotOf(pilot({}), 1);
  const shuffled = { ...snapshot, modules: [...snapshot.modules].reverse() };
  assert.deepEqual(readSnapshot(shuffled)?.modules.map((m) => m.position), [0, 1]);
});

/* --- refusing a snapshot means refusing it -------------------------------
 *
 * Codex's first blocking finding. `readSnapshot` promised that an unreadable snapshot was omitted
 * rather than half-rendered, and then normalised a missing required string to `""`, a missing
 * modules array to `[]`, and a malformed module to empty title and outcome — so a corrupt row
 * reached the public page looking like a teacher who could not be bothered to fill it in.
 *
 * The test that claimed to cover this never removed a required field, so it passed without
 * exercising its own title. These do.
 */

const REQUIRED_STRINGS = [
  "title", "summary", "outcome", "intendedLearner", "startingLevel", "teachingLanguage",
] as const;

test("every required published field must be present, a string, and not blank", () => {
  const good = snapshotOf(pilot({}), 1);
  for (const field of REQUIRED_STRINGS) {
    for (const [what, broken] of [
      ["missing", { ...good, [field]: undefined }],
      ["null", { ...good, [field]: null }],
      ["blank", { ...good, [field]: "   " }],
      ["empty", { ...good, [field]: "" }],
      ["a number", { ...good, [field]: 42 }],
      ["an object", { ...good, [field]: { text: "x" } }],
    ] as const) {
      assert.equal(readSnapshot(broken), null, `${field} ${what} must be refused`);
    }
  }
});

test("an optional field is absent or a real answer, never a blank string", () => {
  const good = snapshotOf(pilot({ prerequisites: "Some algebra", equipment: "A notebook" }), 1);
  assert.equal(readSnapshot({ ...good, prerequisites: null })?.prerequisites, null);
  assert.equal(readSnapshot({ ...good, prerequisites: undefined })?.prerequisites, null);
  for (const broken of [{ ...good, equipment: "" }, { ...good, equipment: "  " }, { ...good, equipment: 7 }]) {
    assert.equal(readSnapshot(broken), null, "a blank or wrongly typed optional is malformed, not absent");
  }
});

test("the version must be a whole number of publications, starting at one", () => {
  const good = snapshotOf(pilot({}), 1);
  for (const version of [0, -1, 1.5, NaN, Infinity, "1", null, undefined, Number.MAX_SAFE_INTEGER + 2]) {
    assert.equal(readSnapshot({ ...good, version }), null, `version ${String(version)} must be refused`);
  }
  assert.equal(readSnapshot({ ...good, version: 1 })?.version, 1);
});

test("a program with no steps, or steps that are not a list, is not a program", () => {
  const good = snapshotOf(pilot({}), 1);
  for (const modules of [undefined, null, [], "two of them", {}, 3]) {
    assert.equal(readSnapshot({ ...good, modules }), null, `modules ${JSON.stringify(modules)} must be refused`);
  }
});

test("a step missing its title or its outcome is refused, not blanked", () => {
  const good = snapshotOf(pilot({}), 1);
  const first = good.modules[0]!;
  for (const [what, broken] of [
    ["no title", { ...first, title: undefined }],
    ["a blank title", { ...first, title: "  " }],
    ["a numeric title", { ...first, title: 1 }],
    ["no outcome", { ...first, outcome: undefined }],
    ["a blank outcome", { ...first, outcome: "" }],
    ["a blank optional", { ...first, description: "" }],
    ["not an object at all", "just a string"],
    ["null", null],
  ] as const) {
    assert.equal(readSnapshot({ ...good, modules: [broken, good.modules[1]] }), null,
      `a step with ${what} must be refused`);
  }
});

test("positions must be whole, non-negative, unique and dense", () => {
  const good = snapshotOf(pilot({}), 1);
  const [a, b] = good.modules;
  for (const [what, modules] of [
    ["a gap", [{ ...a!, position: 0 }, { ...b!, position: 2 }]],
    ["a duplicate", [{ ...a!, position: 1 }, { ...b!, position: 1 }]],
    ["a negative", [{ ...a!, position: -1 }, { ...b!, position: 0 }]],
    ["a fraction", [{ ...a!, position: 0.5 }, { ...b!, position: 1 }]],
    ["a string", [{ ...a!, position: "0" }, { ...b!, position: 1 }]],
    ["none at all", [{ ...a!, position: undefined }, { ...b!, position: 1 }]],
    ["a start at one", [{ ...a!, position: 1 }, { ...b!, position: 2 }]],
  ] as const) {
    assert.equal(readSnapshot({ ...good, modules }), null, `${what} must be refused`);
  }
  // Out of order is fine — order is what `position` is for. It is put back in order, not renumbered.
  assert.deepEqual(
    readSnapshot({ ...good, modules: [{ ...b!, position: 1 }, { ...a!, position: 0 }] })?.modules.map((m) => m.title),
    [a!.title, b!.title],
  );
});

test("a snapshot that could not have been published cannot be read back as published", () => {
  /*
    The gate that does not have to be maintained. Shape is checked above; this is content, and it is
    checked by running the real publish validator rather than repeating its rules — so a rule added
    to the contract tomorrow guards the read path too.
  */
  const exam = snapshotOf(pilot({
    type: "exam_preparation",
    referenceName: "Nepal Engineering Council registration examination",
    referenceSource: "teacher_supplied",
  }), 1);
  assert.notEqual(readSnapshot(exam), null, "the honest one reads back");

  assert.equal(readSnapshot({ ...exam, referenceName: null, referenceSource: "none" }), null,
    "an exam program that names no exam could never have been published");
  assert.equal(readSnapshot({ ...exam, outcome: "Students are guaranteed to pass." }), null,
    "nor could one guaranteeing a result");
  assert.equal(readSnapshot({ ...exam, title: "Short" }), null,
    "nor one whose title is below the contract's minimum");
});

test("a snapshot is only served when its version is the one the row says is current", () => {
  const snapshot = snapshotOf(pilot({}), 2);
  assert.deepEqual(publishedSnapshotFor({ version: 2, publishedSnapshot: snapshot }), snapshot);
  /*
    The row and its snapshot are written by one statement, so a disagreement means they came from
    different publications — a half-applied write, or a hand-edited row. Serving either half of that
    is serving a promise nobody made.
  */
  assert.equal(publishedSnapshotFor({ version: 3, publishedSnapshot: snapshot }), null, "row ahead");
  assert.equal(publishedSnapshotFor({ version: 1, publishedSnapshot: snapshot }), null, "row behind");
  assert.equal(publishedSnapshotFor({ version: 1, publishedSnapshot: null }), null, "nothing published");
});

test("nothing corrupt is repaired into something that looks unfinished", () => {
  // The shape of the old failure, stated once as its own test: a snapshot missing everything used
  // to come back as a readable program with empty strings and no steps.
  const emptied = { version: 1, type: "custom", referenceSource: "none" };
  assert.equal(readSnapshot(emptied), null);
  for (const outer of [null, undefined, "a string", 7, [], [{ version: 1 }]]) {
    assert.equal(readSnapshot(outer), null, `${JSON.stringify(outer)} is not a snapshot`);
  }
});

test("an edit after publication is visible to its author and to nobody else", () => {
  const published = snapshotOf(pilot({}), 1);
  assert.equal(hasUnpublishedChanges(pilot({}), published), false, "no edit, nothing to say");

  const edited = pilot({ outcome: "Students can work through the material on their own." });
  assert.equal(hasUnpublishedChanges(edited, published), true);
  // And the snapshot itself is untouched by the edit — which is the whole immutability argument.
  assert.equal(published.outcome, "Students can work through the material with support.");
});

test("whitespace a teacher added and then removed is not a change", () => {
  const published = snapshotOf(pilot({}), 1);
  assert.equal(hasUnpublishedChanges(pilot({ title: "  A programme with a long enough name  " }), published), false);
});

test("a program that has never been published has no unpublished changes", () => {
  assert.equal(hasUnpublishedChanges(pilot({}), null), false, "there is no 'since' yet");
});
