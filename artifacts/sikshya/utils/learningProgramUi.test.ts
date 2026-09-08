import assert from "node:assert/strict";
import test from "node:test";

import {
  PROGRAM_TYPES,
  PROGRAM_TYPE_CHOICES,
  canMoveDown,
  canMoveUp,
  confirmCopy,
  draftDiffers,
  emptyModule,
  fieldsShownFor,
  groupPrograms,
  moveModule,
  placeIssues,
  programActions,
  programStatusChip,
  programTitle,
  programTypeLabel,
  publishBlock,
  publishOffer,
  saveBody,
  saveChip,
  studioSections,
  wouldLoseWork,
  type ProgramDetail,
  type ProgramDraft,
  type ProgramSummary,
} from "./learningProgramUi.ts";

/**
 * Every decision the program studio makes about what to draw, exercised without a browser.
 *
 * The screens are wire between this file and the Phase 1 API, so this is where the rules live and
 * this is where they are checked. Two of them matter more than the rest and have a test each,
 * stated as their own sentence: a program that has ever been published is never offered permanent
 * deletion, and nothing in the whole surface invents a number.
 */

const draft = (over: Partial<ProgramDraft> = {}): ProgramDraft => ({
  type: "custom",
  title: "A programme with a long enough name",
  summary: "What this covers, who it suits, and how the weeks are spent together.",
  outcome: "Students can work through the material with support.",
  intendedLearner: "Anyone starting out",
  startingLevel: "Beginner",
  teachingLanguage: "Nepali and English",
  prerequisites: null,
  equipment: null,
  referenceName: null,
  referenceSource: "none",
  modules: [
    { title: "Where we start", outcome: "Know what the first lesson covers." },
    { title: "Practising it", outcome: "Work through examples each week." },
  ],
  ...over,
});

const detail = (over: Partial<ProgramDetail> = {}): ProgramDetail => ({
  id: 1,
  status: "draft",
  type: "custom",
  title: "A programme with a long enough name",
  version: 0,
  draft: draft(),
  issues: [],
  published: null,
  hasUnpublishedChanges: false,
  ...over,
});

/* --- status ---------------------------------------------------------------- */

test("the four states a teacher has to tell apart are four different chips", () => {
  const seen = [
    programStatusChip({ status: "draft" }),
    programStatusChip({ status: "published", hasUnpublishedChanges: false }),
    programStatusChip({ status: "published", hasUnpublishedChanges: true }),
    programStatusChip({ status: "archived" }),
  ];
  assert.deepEqual(seen.map((chip) => chip.label), [
    "Draft", "Published", "Changes not published", "Archived",
  ]);
  assert.equal(new Set(seen.map((chip) => chip.label)).size, 4);
  assert.equal(new Set(seen.map((chip) => chip.tone)).size, 4, "and four tones, so colour alone distinguishes them");
});

test("a published program with unpublished edits says which version students see", () => {
  const chip = programStatusChip({ status: "published", hasUnpublishedChanges: true });
  assert.match(chip.hint ?? "", /students still see the version you published/i);
});

test("an unknown status is drawn as a draft rather than as nothing", () => {
  // A payload from a newer server must not produce a card with no state at all.
  assert.equal(programStatusChip({ status: "something_new" }).label, "Draft");
});

/* --- destructive actions ---------------------------------------------------- */

test("a program that has ever been published is never offered permanent deletion", () => {
  /*
    The rule this file exists for. The server refuses it; this makes sure a teacher is never invited
    to try, because the page is the only record of what students were promised.
  */
  const cases: ProgramDetail[] = [
    detail({ status: "published", version: 1, published: { version: 1 } }),
    // Taken down: a draft again, but its history survives in the version.
    detail({ status: "draft", version: 2, published: { version: 2 } }),
    // Archived after publication.
    detail({ status: "archived", version: 3, published: { version: 3 } }),
    // Version alone, with no snapshot carried in this payload.
    detail({ status: "draft", version: 1, published: null }),
  ];
  for (const program of cases) {
    const actions = programActions(program).map((offer) => offer.action);
    assert.ok(!actions.includes("delete"), `${program.status} v${program.version} must not offer delete`);
  }
});

test("a draft that has never been published may be deleted", () => {
  const actions = programActions(detail()).map((offer) => offer.action);
  assert.ok(actions.includes("delete"));
  assert.ok(actions.includes("archive"));
  assert.ok(!actions.includes("unpublish"), "there is nothing to take down");
  assert.ok(!actions.includes("restore"), "it is not archived");
});

test("a published program is offered taking down and archiving, in that order", () => {
  const actions = programActions(detail({ status: "published", version: 1, published: { version: 1 } }))
    .map((offer) => offer.action);
  assert.deepEqual(actions, ["unpublish", "archive"]);
});

test("an archived program is offered only restoring", () => {
  const offers = programActions(detail({ status: "archived", version: 0 }));
  assert.deepEqual(offers.map((offer) => offer.action), ["restore"]);
  assert.equal(offers[0]?.confirm, false, "bringing something back needs no warning");
});

test("every action that changes the world asks first", () => {
  const offers = programActions(detail());
  for (const offer of offers) {
    assert.equal(offer.confirm, true, `${offer.action} should confirm`);
  }
});

test("a delete is drawn as danger and never as the primary action", () => {
  const del = programActions(detail()).find((offer) => offer.action === "delete");
  assert.equal(del?.emphasis, "danger");
  const primaries = programActions(detail()).filter((offer) => offer.emphasis === "primary");
  assert.equal(primaries.length, 0, "the primary action on the studio is Publish, not a lifecycle move");
});

test("every offer says the whole sentence to a screen reader", () => {
  for (const status of ["draft", "published", "archived"] as const) {
    for (const offer of programActions(detail({ status, version: status === "published" ? 1 : 0 }))) {
      assert.ok(offer.spoken.length > offer.label.length,
        `${offer.action}: "${offer.spoken}" should say more than "${offer.label}"`);
    }
  }
});

test("confirmation copy exists for every action and names what happens", () => {
  for (const action of ["publish", "unpublish", "archive", "restore", "delete"] as const) {
    const copy = confirmCopy(action);
    assert.ok(copy.title.endsWith("?"), `${action} should ask`);
    assert.ok(copy.body.length > 20, `${action} should explain`);
    assert.ok(copy.confirm.length > 0);
  }
  assert.match(confirmCopy("delete").body, /cannot be undone/i);
  assert.match(confirmCopy("unpublish").body, /your work is kept/i);
});

/* --- publication blocks ------------------------------------------------------ */

test("an unapproved teacher may write but is told plainly why publishing is locked", () => {
  const block = publishBlock(detail(), { approved: false });
  assert.equal(block.blocked && block.code, "approval");
  assert.match(block.blocked ? block.body : "", /write and save as much as you like/i);
});

test("approval is explained before an incomplete draft is, because fixing fields would not unblock them", () => {
  const block = publishBlock(
    detail({ issues: [{ field: "outcome", code: "required", message: "Learning outcome is required." }] }),
    { approved: false },
  );
  assert.equal(block.blocked && block.code, "approval");
});

test("an approved teacher with an incomplete draft is told how many things are left", () => {
  const one = publishBlock(
    detail({ issues: [{ field: "outcome", code: "required", message: "x" }] }),
    { approved: true },
  );
  assert.equal(one.blocked && one.code, "incomplete");
  assert.match(one.blocked ? one.title : "", /one thing left/i);

  const three = publishBlock(
    detail({ issues: [
      { field: "outcome", code: "required", message: "x" },
      { field: "title", code: "required", message: "y" },
      { field: "modules", code: "required", message: "z" },
    ] }),
    { approved: true },
  );
  assert.match(three.blocked ? three.title : "", /3 things left/i);
});

test("an archived program says to restore it rather than blaming the account or the draft", () => {
  const block = publishBlock(detail({ status: "archived" }), { approved: false });
  assert.equal(block.blocked && block.code, "archived");
  assert.match(block.blocked ? block.body : "", /restore/i);
});

test("an approved teacher with a complete draft is not blocked", () => {
  assert.equal(publishBlock(detail(), { approved: true }).blocked, false);
});

test("the publish button never offers changes that do not exist", () => {
  /*
    The review card and the button underneath it are two sentences about the same fact, and they
    were disagreeing: "This matches what you have written here" sat directly above "Publish your
    changes". Whichever one a teacher believed, the screen had told them the other.
  */
  const inStep = publishOffer(detail({ status: "published", hasUnpublishedChanges: false }));
  assert.equal(inStep.label, "Publish again");
  assert.match(inStep.spoken, /nothing has changed/i);

  const ahead = publishOffer(detail({ status: "published", hasUnpublishedChanges: true }));
  assert.equal(ahead.label, "Publish your changes");

  assert.equal(publishOffer(detail({ status: "draft" })).label, "Publish");
});

/* --- saving ------------------------------------------------------------------ */

test("the save chip has a distinct answer for each of the five states", () => {
  const labels = (["clean", "unsaved", "saving", "saved", "failed"] as const).map((state) => saveChip(state).label);
  assert.equal(new Set(labels).size, 5, JSON.stringify(labels));
  assert.deepEqual(labels, ["All changes saved", "Unsaved changes", "Saving…", "Saved", "Save failed"]);
});

test("only a confirmed save reads as done", () => {
  // The brief's rule. `saving` is not `saved`, and neither is a failure.
  assert.equal(saveChip("saving").atRisk, true);
  assert.equal(saveChip("failed").atRisk, true);
  assert.equal(saveChip("unsaved").atRisk, true);
  assert.equal(saveChip("saved").atRisk, false);
  assert.equal(saveChip("clean").atRisk, false);
});

test("leaving is only dangerous while work is at risk", () => {
  assert.equal(wouldLoseWork("unsaved"), true);
  assert.equal(wouldLoseWork("failed"), true);
  assert.equal(wouldLoseWork("saving"), true);
  assert.equal(wouldLoseWork("saved"), false);
  assert.equal(wouldLoseWork("clean"), false);
});

/* --- progressive disclosure --------------------------------------------------- */

test("a practical skill is never asked for a curriculum", () => {
  // The blueprint's own example: a guitar teacher must not be pushed through a school form.
  const ids = studioSections("practical_skill").map((section) => section.id);
  assert.ok(!ids.includes("reference"), JSON.stringify(ids));
  assert.ok(!fieldsShownFor("practical_skill").includes("referenceName"));
});

test("an exam program must name its exam, and the section says why", () => {
  const reference = studioSections("exam_preparation").find((section) => section.id === "reference");
  assert.ok(reference, "an exam program has a reference section");
  assert.match(reference!.title, /exam/i);
  assert.match(reference!.blurb, /exactly as it is written/i);
  const field = reference!.fields.find((f) => f.name === "referenceName");
  assert.equal(field?.required, true, "the server refuses publication without it");
});

test("a school subject or a language may cite a syllabus, and is told Fadko does not endorse it", () => {
  for (const type of ["school_subject", "language"] as const) {
    const reference = studioSections(type).find((section) => section.id === "reference");
    assert.ok(reference, `${type} has a reference section`);
    assert.equal(reference!.fields[0]?.required, false, `${type} may leave it empty`);
    assert.match(reference!.blurb, /does not check or endorse/i);
  }
});

test("every type gets the same six-or-five sections in the same order", () => {
  for (const type of PROGRAM_TYPES) {
    const ids = studioSections(type).map((section) => section.id);
    assert.equal(ids[0], "learn");
    assert.equal(ids[1], "who");
    assert.equal(ids[2], "path");
    assert.equal(ids[3], "requirements");
    assert.equal(ids[ids.length - 1], "review", `${type} ends at review`);
  }
});

test("the server's own prompt is used where it supplies one", () => {
  const sections = studioSections("school_subject", {
    promisePrompt: "What topic will students understand or be able to solve?",
    learnerPrompt: "Which grade or starting knowledge is this right for?",
    referencePrompt: "Which curriculum, textbook or syllabus do you follow, if any?",
  });
  const outcome = sections[0]?.fields.find((f) => f.name === "outcome");
  assert.equal(outcome?.help, "What topic will students understand or be able to solve?");
  const reference = sections.find((s) => s.id === "reference")?.fields[0];
  assert.equal(reference?.help, "Which curriculum, textbook or syllabus do you follow, if any?");
});

test("every required draft field the server validates is shown somewhere", () => {
  /*
    The check that stops a validation issue being unreachable. If the contract gains a required
    field and no section draws it, a teacher would be told something is missing with nowhere to fix
    it — so the studio is compared against the fields the publish contract requires.
  */
  const required = [
    "title", "summary", "outcome", "intendedLearner", "startingLevel", "teachingLanguage",
  ];
  for (const type of PROGRAM_TYPES) {
    const shown = fieldsShownFor(type);
    for (const field of required) {
      assert.ok(shown.includes(field), `${type} must show ${field}`);
    }
  }
});

/* --- validation issues, placed ------------------------------------------------ */

test("each server issue lands beside the field it names", () => {
  const placed = placeIssues([
    { field: "outcome", code: "required", message: "Learning outcome is required." },
    { field: "teachingLanguage", code: "too_short", message: "Teaching language needs more detail." },
  ], "custom");
  assert.equal(placed.sections.learn.byField.outcome?.length, 1);
  assert.equal(placed.sections.learn.count, 1);
  assert.equal(placed.sections.requirements.byField.teachingLanguage?.length, 1);
  assert.equal(placed.unplaced.length, 0);
});

test("a module issue lands on its step, and the path section counts it", () => {
  const placed = placeIssues([
    { field: "modules.1.title", code: "required", message: "Step 2 title is required." },
    { field: "modules.1.outcome", code: "too_short", message: "Step 2 outcome needs more detail." },
  ], "custom");
  assert.equal(placed.modules[1]?.length, 2);
  assert.equal(placed.sections.path.count, 2);
  assert.equal(placed.unplaced.length, 0);
});

test("an issue about the list itself sits above the steps rather than on one of them", () => {
  const placed = placeIssues([
    { field: "modules", code: "required", message: "Add at least one step to the learning path." },
  ], "custom");
  assert.equal(placed.sections.path.loose.length, 1);
  assert.equal(Object.keys(placed.modules).length, 0);
});

test("an issue with no field on this screen is carried to review rather than dropped", () => {
  /*
    A `referenceName` issue on a practical skill, which draws no reference section. Dropping it
    would leave a teacher told "one thing left to finish" with nowhere to find it — a puzzle rather
    than a task.
  */
  const placed = placeIssues([
    { field: "referenceName", code: "required", message: "Name the exact exam this program prepares for." },
    { field: "type", code: "invalid", message: "Choose what kind of program this is." },
  ], "practical_skill");
  assert.equal(placed.unplaced.length, 2);
  assert.equal(placed.sections.review.count, 2);
});

test("no issue is ever lost, whatever it names", () => {
  const issues = [
    { field: "title", code: "required", message: "a" },
    { field: "modules", code: "required", message: "b" },
    { field: "modules.0.outcome", code: "too_short", message: "c" },
    { field: "something_invented", code: "invalid", message: "d" },
  ];
  const placed = placeIssues(issues, "custom");
  const counted =
    Object.values(placed.sections).reduce((sum, section) => sum + section.count, 0);
  assert.equal(counted, issues.length, "every issue is counted exactly once, somewhere");
});

/* --- the module editor --------------------------------------------------------- */

test("a step moves up and down, and the rest keep their order", () => {
  const list = ["a", "b", "c", "d"];
  assert.deepEqual(moveModule(list, 2, -1), ["a", "c", "b", "d"]);
  assert.deepEqual(moveModule(list, 1, 1), ["a", "c", "b", "d"]);
  assert.deepEqual(moveModule(list, 0, 1), ["b", "a", "c", "d"]);
});

test("moving off either end changes nothing and does not throw", () => {
  const list = ["a", "b"];
  assert.deepEqual(moveModule(list, 0, -1), list);
  assert.deepEqual(moveModule(list, 1, 1), list);
  assert.deepEqual(moveModule(list, -1, 1), list);
  assert.deepEqual(moveModule(list, 9, -1), list);
});

test("moving never mutates the list it was given", () => {
  const list = ["a", "b", "c"];
  moveModule(list, 0, 1);
  assert.deepEqual(list, ["a", "b", "c"], "a screen compares the two to know it has unsaved work");
});

test("the move controls are disabled exactly at the ends", () => {
  assert.equal(canMoveUp(0), false);
  assert.equal(canMoveUp(1), true);
  assert.equal(canMoveDown(2, 3), false);
  assert.equal(canMoveDown(1, 3), true);
  assert.equal(canMoveDown(0, 1), false, "a single step moves nowhere");
});

test("a new step is empty rather than pre-filled", () => {
  // A placeholder a teacher forgets to edit becomes a promise nobody meant to make.
  assert.deepEqual(emptyModule(), { title: "", outcome: "", description: null, practicePrompt: null });
});

/* --- unsaved work --------------------------------------------------------------- */

test("typing something is a change, and whitespace alone is not", () => {
  assert.equal(draftDiffers(draft(), draft()), false);
  assert.equal(draftDiffers(draft(), draft({ outcome: "Something else entirely." })), true);
  assert.equal(draftDiffers(draft(), draft({ title: "  A programme with a long enough name  " })), false);
});

test("reordering or editing a step is a change", () => {
  const moved = draft({ modules: moveModule(draft().modules, 0, 1) });
  assert.equal(draftDiffers(draft(), moved), true);
  const edited = draft({ modules: [{ title: "Where we start", outcome: "Different." }, draft().modules[1]!] });
  assert.equal(draftDiffers(draft(), edited), true);
});

test("null and an empty string mean the same thing for an optional field", () => {
  assert.equal(draftDiffers(draft({ equipment: null }), draft({ equipment: "" })), false);
  assert.equal(draftDiffers(draft({ equipment: null }), draft({ equipment: "A guitar" })), true);
});

/* --- what is sent ---------------------------------------------------------------- */

test("naming a reference makes it the teacher's own citation, never an official one", () => {
  /*
    There is no screen on which a teacher could claim an official endorsement, so the only honest
    value is `teacher_supplied`. The server carries the distinction to the student verbatim.
  */
  assert.equal(saveBody(draft({ referenceName: "SEE Mathematics syllabus" })).referenceSource, "teacher_supplied");
  assert.equal(saveBody(draft({ referenceName: null })).referenceSource, "none");
  assert.equal(saveBody(draft({ referenceName: "   " })).referenceSource, "none");
});

test("what is sent carries no price, count, rating or anything else nobody knows", () => {
  const body = saveBody(draft());
  const keys = Object.keys(body).sort();
  assert.deepEqual(keys, [
    "equipment", "intendedLearner", "modules", "outcome", "prerequisites", "referenceName",
    "referenceSource", "startingLevel", "summary", "teachingLanguage", "title", "type",
  ]);
  for (const invented of ["price", "rating", "students", "enrolled", "popular", "capacity", "schedule"]) {
    assert.ok(!keys.includes(invented), `saveBody must not carry ${invented}`);
  }
});

test("steps are sent in the order they are shown, with no position of their own", () => {
  const body = saveBody(draft()) as { modules: Record<string, unknown>[] };
  assert.deepEqual(body.modules.map((m) => m.title), ["Where we start", "Practising it"]);
  assert.ok(body.modules.every((m) => !("position" in m)), "the server renumbers from the order it is sent");
});

/* --- the list ---------------------------------------------------------------------- */

const summary = (over: Partial<ProgramSummary>): ProgramSummary => ({
  id: 1, status: "draft", type: "custom", title: "One", version: 0, ...over,
});

test("programs are grouped published, drafts, archived — and empty groups are absent", () => {
  const groups = groupPrograms([
    summary({ id: 1, status: "draft" }),
    summary({ id: 2, status: "published", version: 1 }),
    summary({ id: 3, status: "archived" }),
  ]);
  assert.deepEqual(groups.map((group) => group.id), ["live", "working", "archived"]);

  const onlyDrafts = groupPrograms([summary({ id: 1, status: "draft" })]);
  assert.deepEqual(onlyDrafts.map((group) => group.id), ["working"]);
  assert.deepEqual(groupPrograms([]), []);
});

test("a program with no name yet is called something rather than nothing", () => {
  assert.equal(programTitle({ title: null }), "Untitled program");
  assert.equal(programTitle({ title: "   " }), "Untitled program");
  assert.equal(programTitle({ title: "Grade 10 Mathematics" }), "Grade 10 Mathematics");
});

test("every program type has a readable label, and an unknown one falls back to itself", () => {
  for (const type of PROGRAM_TYPES) {
    const label = programTypeLabel(type);
    assert.ok(label.length > 0 && !label.includes("_"), `${type} -> ${label}`);
  }
  assert.equal(programTypeLabel("driving_lesson"), "driving_lesson", "never blank, never invented");
});

/* --- the create flow ----------------------------------------------------------------- */

test("the create flow offers exactly the five types the contract supports", () => {
  assert.equal(PROGRAM_TYPE_CHOICES.length, 5);
  assert.deepEqual(
    [...PROGRAM_TYPE_CHOICES.map((choice) => choice.type)].sort(),
    [...PROGRAM_TYPES].sort(),
    "no sixth choice, and none missing",
  );
});

test("each choice explains in one short sentence what it is for", () => {
  for (const choice of PROGRAM_TYPE_CHOICES) {
    assert.ok(choice.blurb.length > 30, `${choice.type} needs a real sentence`);
    assert.ok(choice.blurb.length < 120, `${choice.type} blurb should stay one line's worth`);
    assert.ok(choice.blurb.trim().endsWith("."), `${choice.type} should read as a sentence`);
    assert.ok(choice.name.length > 0 && choice.icon.length > 0);
  }
});

test("the exam choice says out loud that results are not promised", () => {
  const exam = PROGRAM_TYPE_CHOICES.find((choice) => choice.type === "exam_preparation");
  assert.match(exam?.blurb ?? "", /no promises about results/i);
});

/* --- nothing is invented ---------------------------------------------------------------- */

test("no derivation in this file produces a number nobody has", () => {
  /*
    The standing rule, checked over the whole surface rather than screen by screen. Every string
    this file can produce is collected and searched for the shapes a fabricated statistic takes.
  */
  const produced = [
    ...(["draft", "published", "archived"] as const).flatMap((status) => {
      const chip = programStatusChip({ status, hasUnpublishedChanges: true });
      return [chip.label, chip.hint ?? ""];
    }),
    ...programActions(detail()).flatMap((offer) => [offer.label, offer.spoken]),
    ...(["publish", "unpublish", "archive", "restore", "delete"] as const)
      .flatMap((action) => Object.values(confirmCopy(action))),
    ...(["clean", "unsaved", "saving", "saved", "failed"] as const).map((state) => saveChip(state).label),
    ...PROGRAM_TYPE_CHOICES.flatMap((choice) => [choice.name, choice.blurb]),
    ...PROGRAM_TYPES.flatMap((type) =>
      studioSections(type).flatMap((section) => [
        section.title,
        section.blurb,
        ...section.fields.flatMap((field) => [field.label, field.help ?? "", field.placeholder ?? ""]),
      ]),
    ),
  ].join(" ").toLowerCase();

  /*
    Whole claims rather than fragments. "star" alone matches "Starting level", which is a real
    question a teacher answers — a check that fails on a true sentence gets weakened rather than
    obeyed, so it names the claims themselves.
  */
  for (const forbidden of [
    "rating", "star rating", "out of 5", "review score", "students enrolled", "popular",
    "top pick", "npr", "price", "earnings", "revenue", "available now", "verified by fadko",
  ]) {
    assert.ok(!produced.includes(forbidden), `the studio must never say "${forbidden}"`);
  }
});
