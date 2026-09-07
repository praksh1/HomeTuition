/**
 * Provider- and database-independent contract for Fadko Learning Programs.
 *
 * A program is the teaching promise and learning path. It is deliberately not a payment plan,
 * a recurring-class row, or a live classroom. Keeping this pure lets the teacher builder, API
 * and future schema share one vocabulary without changing today's booking or membership rules.
 */
export const PROGRAM_TYPES = [
  "school_subject",
  "practical_skill",
  "language",
  "exam_preparation",
  "custom",
] as const;
export type LearningProgramType = (typeof PROGRAM_TYPES)[number];
export type ReferenceSource = "official" | "teacher_supplied" | "none";

export interface LearningProgramModuleDraft {
  title: string;
  outcome: string;
  description?: string;
  practicePrompt?: string;
}

export interface LearningProgramDraft {
  type: LearningProgramType;
  title: string;
  summary: string;
  outcome: string;
  intendedLearner: string;
  startingLevel: string;
  teachingLanguage: string;
  prerequisites?: string;
  equipment?: string;
  referenceName?: string;
  referenceSource: ReferenceSource;
  modules: LearningProgramModuleDraft[];
}

export interface ProgramValidationIssue {
  field: string;
  code: "required" | "too_short" | "too_long" | "invalid" | "unsupported_claim";
  message: string;
}

const LIMITS = {
  title: { min: 8, max: 90 },
  summary: { min: 24, max: 240 },
  outcome: { min: 16, max: 240 },
  intendedLearner: { min: 8, max: 160 },
  startingLevel: { min: 2, max: 100 },
  teachingLanguage: { min: 2, max: 100 },
  moduleTitle: { min: 3, max: 100 },
  moduleOutcome: { min: 8, max: 220 },
  moduleDescription: { max: 600 },
  practicePrompt: { max: 600 },
  modules: { min: 1, max: 40 },
} as const;

const GUARANTEE_PATTERN = /\b(guaranteed?|100\s*%|certain(?:ly)?|will\s+pass|pass\s+for\s+sure)\b/i;

function textIssue(
  issues: ProgramValidationIssue[],
  field: string,
  value: string | undefined,
  label: string,
  limits: { min?: number; max: number },
) {
  const length = value?.trim().length ?? 0;
  if (length === 0) {
    issues.push({ field, code: "required", message: `${label} is required.` });
  } else if (limits.min !== undefined && length < limits.min) {
    issues.push({ field, code: "too_short", message: `${label} needs a little more detail.` });
  } else if (length > limits.max) {
    issues.push({ field, code: "too_long", message: `${label} is too long.` });
  }
}

/**
 * Publish-level validation. A draft may be saved before this returns no issues; publication may
 * not. Messages are written for the teacher, while stable codes/fields are written for clients.
 */
export function validateLearningProgramForPublish(
  draft: LearningProgramDraft,
): ProgramValidationIssue[] {
  const issues: ProgramValidationIssue[] = [];

  if (!PROGRAM_TYPES.includes(draft.type)) {
    issues.push({ field: "type", code: "invalid", message: "Choose what kind of program this is." });
  }
  textIssue(issues, "title", draft.title, "Program title", LIMITS.title);
  textIssue(issues, "summary", draft.summary, "Short description", LIMITS.summary);
  textIssue(issues, "outcome", draft.outcome, "Learning outcome", LIMITS.outcome);
  textIssue(issues, "intendedLearner", draft.intendedLearner, "Right learner", LIMITS.intendedLearner);
  textIssue(issues, "startingLevel", draft.startingLevel, "Starting level", LIMITS.startingLevel);
  textIssue(issues, "teachingLanguage", draft.teachingLanguage, "Teaching language", LIMITS.teachingLanguage);

  if (!(["official", "teacher_supplied", "none"] as const).includes(draft.referenceSource)) {
    issues.push({ field: "referenceSource", code: "invalid", message: "Choose where the reference comes from." });
  }
  if (draft.type === "exam_preparation" && !draft.referenceName?.trim()) {
    issues.push({ field: "referenceName", code: "required", message: "Name the exact exam this program prepares for." });
  }
  if (draft.referenceSource !== "none" && !draft.referenceName?.trim()) {
    issues.push({ field: "referenceName", code: "required", message: "Name the curriculum or exam reference." });
  }

  if (draft.modules.length < LIMITS.modules.min) {
    issues.push({ field: "modules", code: "required", message: "Add at least one step to the learning path." });
  } else if (draft.modules.length > LIMITS.modules.max) {
    issues.push({ field: "modules", code: "too_long", message: "Split this into smaller programs with no more than 40 steps each." });
  }

  draft.modules.forEach((module, index) => {
    const field = `modules.${index}`;
    textIssue(issues, `${field}.title`, module.title, `Step ${index + 1} title`, LIMITS.moduleTitle);
    textIssue(issues, `${field}.outcome`, module.outcome, `Step ${index + 1} outcome`, LIMITS.moduleOutcome);
    if ((module.description?.trim().length ?? 0) > LIMITS.moduleDescription.max) {
      issues.push({ field: `${field}.description`, code: "too_long", message: `Step ${index + 1} description is too long.` });
    }
    if ((module.practicePrompt?.trim().length ?? 0) > LIMITS.practicePrompt.max) {
      issues.push({ field: `${field}.practicePrompt`, code: "too_long", message: `Step ${index + 1} practice is too long.` });
    }
  });

  if (draft.type === "exam_preparation" && GUARANTEE_PATTERN.test(`${draft.summary} ${draft.outcome}`)) {
    issues.push({
      field: "outcome",
      code: "unsupported_claim",
      message: "Describe the preparation students receive without guaranteeing an exam result.",
    });
  }

  return issues;
}

export interface LearningProgramTemplate {
  type: LearningProgramType;
  name: string;
  promisePrompt: string;
  learnerPrompt: string;
  referencePrompt: string | null;
  examples: readonly string[];
}

/** Honest prompts only: templates help a teacher think, but never fill in a claim for them. */
export const LEARNING_PROGRAM_TEMPLATES: readonly LearningProgramTemplate[] = [
  {
    type: "school_subject",
    name: "School subject",
    promisePrompt: "What topic will students understand or be able to solve?",
    learnerPrompt: "Which grade or starting knowledge is this right for?",
    referencePrompt: "Which curriculum, textbook or syllabus do you follow, if any?",
    examples: ["Grade 10 Mathematics", "Class 8 Science revision"],
  },
  {
    type: "practical_skill",
    name: "Practical skill",
    promisePrompt: "What will students be able to demonstrate by the end?",
    learnerPrompt: "What can a complete beginner start with?",
    referencePrompt: null,
    examples: ["Beginner guitar", "Introduction to sketching"],
  },
  {
    type: "language",
    name: "Language",
    promisePrompt: "What real conversation, reading or writing task will students practise?",
    learnerPrompt: "What language level should students start at?",
    referencePrompt: "Do you follow a named level framework or book, if any?",
    examples: ["Spoken English for daily life", "Beginner Japanese conversation"],
  },
  {
    type: "exam_preparation",
    name: "Exam preparation",
    promisePrompt: "Which syllabus areas and exam skills will students practise?",
    learnerPrompt: "Who is eligible for this exam and what should they know already?",
    referencePrompt: "What is the exact exam and source of its syllabus?",
    examples: ["Engineering registration exam preparation", "SEE Mathematics revision"],
  },
  {
    type: "custom",
    name: "Something else",
    promisePrompt: "What will students be able to do after this program?",
    learnerPrompt: "Who is this for and what should they know before joining?",
    referencePrompt: null,
    examples: ["Public speaking practice", "Study skills for first-year students"],
  },
] as const;
