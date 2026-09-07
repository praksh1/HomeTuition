import assert from "node:assert/strict";
import test from "node:test";

import {
  LEARNING_PROGRAM_TEMPLATES,
  PROGRAM_TYPES,
  type LearningProgramDraft,
  validateLearningProgramForPublish,
} from "./learningPrograms.ts";

const pilots: LearningProgramDraft[] = [
  {
    type: "school_subject",
    title: "Grade 10 Mathematics: algebra foundations",
    summary: "Work through core algebra ideas using live examples, whiteboard practice and feedback.",
    outcome: "Students will be able to form, simplify and solve common Grade 10 algebra problems.",
    intendedLearner: "Grade 10 students who want guided practice before their school assessments.",
    startingLevel: "Understands basic arithmetic",
    teachingLanguage: "Nepali and English",
    referenceName: "Teacher-selected Grade 10 Mathematics syllabus",
    referenceSource: "teacher_supplied",
    modules: [{ title: "Expressions", outcome: "Recognise terms and simplify algebraic expressions." }],
  },
  {
    type: "practical_skill",
    title: "Play your first songs on guitar",
    summary: "A live beginner path through tuning, chord shapes, rhythm and complete simple songs.",
    outcome: "Students will be able to tune a guitar, change between basic chords and play two simple songs.",
    intendedLearner: "Complete beginners with access to an acoustic or electric guitar.",
    startingLevel: "Complete beginner",
    teachingLanguage: "Nepali",
    equipment: "A playable guitar and a quiet place to practise",
    referenceSource: "none",
    modules: [{ title: "First chords", outcome: "Hold and change between three open chord shapes." }],
  },
  {
    type: "language",
    title: "Spoken English for everyday confidence",
    summary: "Practise useful conversations with a teacher and receive specific pronunciation feedback.",
    outcome: "Students will be able to introduce themselves and handle common daily conversations in English.",
    intendedLearner: "Nepali speakers who understand some English but need supported speaking practice.",
    startingLevel: "Basic English understanding",
    teachingLanguage: "Nepali and English",
    referenceSource: "none",
    modules: [{ title: "Introductions", outcome: "Give a clear introduction and ask simple follow-up questions." }],
  },
  {
    type: "exam_preparation",
    title: "Engineering registration exam preparation",
    summary: "Review selected syllabus areas, practise timed questions and discuss solution methods.",
    outcome: "Students will be able to identify weak syllabus areas and apply a repeatable method to practice questions.",
    intendedLearner: "Eligible engineering graduates preparing for the named registration examination.",
    startingLevel: "Engineering graduate",
    teachingLanguage: "Nepali and English",
    referenceName: "Engineering professional registration examination",
    referenceSource: "teacher_supplied",
    modules: [{ title: "Readiness review", outcome: "Map current strengths and gaps against the stated syllabus." }],
  },
];

test("all five program types have one distinct teacher-facing template", () => {
  assert.deepEqual(LEARNING_PROGRAM_TEMPLATES.map((template) => template.type), PROGRAM_TYPES);
  assert.equal(new Set(LEARNING_PROGRAM_TEMPLATES.map((template) => template.name)).size, PROGRAM_TYPES.length);
});

test("the four Nepal pilot programs satisfy the shared publish contract", () => {
  for (const pilot of pilots) {
    assert.deepEqual(validateLearningProgramForPublish(pilot), [], pilot.title);
  }
});

test("a practical skill does not require a school, grade or curriculum", () => {
  assert.deepEqual(validateLearningProgramForPublish(pilots[1]), []);
  assert.equal("school" in pilots[1], false);
});

test("an exam-preparation program names the exact exam", () => {
  const draft = { ...pilots[3], referenceName: "" };
  assert.ok(validateLearningProgramForPublish(draft).some((issue) => issue.field === "referenceName"));
});

test("an exam-preparation program cannot guarantee a result", () => {
  const draft = { ...pilots[3], outcome: "Students are guaranteed to pass this registration exam." };
  assert.ok(validateLearningProgramForPublish(draft).some((issue) => issue.code === "unsupported_claim"));
});

test("blank or vague promises cannot be published", () => {
  const draft: LearningProgramDraft = {
    ...pilots[0],
    title: "Math",
    summary: "Good course",
    outcome: "Learn math",
    intendedLearner: "Anyone",
    modules: [],
  };
  const fields = new Set(validateLearningProgramForPublish(draft).map((issue) => issue.field));
  assert.ok(fields.has("title"));
  assert.ok(fields.has("summary"));
  assert.ok(fields.has("outcome"));
  assert.ok(fields.has("intendedLearner"));
  assert.ok(fields.has("modules"));
});

test("module errors point to the exact step a teacher needs to fix", () => {
  const draft = { ...pilots[0], modules: [{ title: "", outcome: "" }, pilots[0].modules[0]] };
  const fields = validateLearningProgramForPublish(draft).map((issue) => issue.field);
  assert.ok(fields.includes("modules.0.title"));
  assert.ok(fields.includes("modules.0.outcome"));
  assert.ok(!fields.includes("modules.1.title"));
});
