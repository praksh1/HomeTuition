/**
 * What a teacher is shown about their own Learning Programs, worked out apart from how it is drawn.
 *
 * ## Why this is a file and not branches inside three screens
 *
 * The program studio has four statuses, an "edited since it was published" state that is not a
 * status, six lifecycle actions each with its own precondition, per-type field visibility, a save
 * state machine, and a list of server validation issues that has to reach the right field. Written
 * inline that is a hundred conditions spread over three screens, and the ones that are wrong are
 * the ones nobody looks at — an Archive button on an archived program, a Delete offered on
 * something a student has already read.
 *
 * ## It offers; the server decides
 *
 * Nothing here grants anything. Every action it produces is sent to the Phase 1 API, which checks
 * it again from scratch inside a row lock — `api-server/src/routes/learningPrograms.ts`. A button
 * that should not be drawn is a cosmetic bug; a button that works when it should not is impossible
 * from here, which is what makes it safe for this file to be the only place the rules are written
 * down for the screens.
 *
 * ## The two rules it exists to hold
 *
 * **Never offer permanent deletion of something that has been published.** Somebody may have read
 * it and acted on it, and the page is the only record of what was promised. The server refuses it;
 * this makes sure a teacher is never invited to try.
 *
 * **Never invent a number.** There is no student count, rating, earning, popularity, availability
 * or price anywhere in this file, and the types below have nowhere to put one.
 */

/** The three states a program can be stored in. Anything else is a payload this build cannot read. */
export type ProgramStatus = "draft" | "published" | "archived";

export type ProgramType =
  | "school_subject"
  | "exam_preparation"
  | "language"
  | "practical_skill"
  | "custom";

export const PROGRAM_TYPES: readonly ProgramType[] = [
  "school_subject",
  "exam_preparation",
  "language",
  "practical_skill",
  "custom",
];

export type ReferenceSource = "official" | "teacher_supplied" | "none";

/** A colour role, never a colour. The screens map these onto the design tokens. */
export type ProgramTone = "neutral" | "waiting" | "live" | "stopped";

export interface ProgramIssue {
  field: string;
  code: string;
  message: string;
}

export interface ProgramModuleDraft {
  id?: number;
  title: string;
  outcome: string;
  description?: string | null;
  practicePrompt?: string | null;
}

export interface ProgramDraft {
  type: ProgramType | string;
  title: string;
  summary: string;
  outcome: string;
  intendedLearner: string;
  startingLevel: string;
  teachingLanguage: string;
  prerequisites?: string | null;
  equipment?: string | null;
  referenceName?: string | null;
  referenceSource: ReferenceSource | string;
  modules: ProgramModuleDraft[];
}

/** One row of the teacher's own list. The server sends exactly this and nothing more. */
export interface ProgramSummary {
  id: number;
  status: ProgramStatus | string;
  type: ProgramType | string;
  title: string | null;
  version: number;
  updatedAt?: string | null;
  publishedAt?: string | null;
}

/** One program open in the studio, as `ownerView` sends it. */
export interface ProgramDetail extends ProgramSummary {
  draft: ProgramDraft;
  issues: ProgramIssue[];
  published: { version: number } | null;
  hasUnpublishedChanges: boolean;
}

/* ========================================================================== *
 * What state a program is in                                                  *
 * ========================================================================== */

export interface ProgramStatusChip {
  label: string;
  tone: ProgramTone;
  /** One short line under the label, where the label alone would leave a question. */
  hint: string | null;
}

/**
 * The four things a teacher needs to be able to tell apart at a glance.
 *
 * "Changes not published" is deliberately its own chip rather than a mark on the published one.
 * It is the state a teacher is most often *in* — they published, then kept working — and it is the
 * one that is dangerous to get wrong in either direction: a teacher who thinks students can see
 * their new outcome when they cannot, or who republishes something they were still drafting.
 */
export function programStatusChip(
  program: { status: ProgramStatus | string; hasUnpublishedChanges?: boolean },
): ProgramStatusChip {
  switch (program.status) {
    case "published":
      return program.hasUnpublishedChanges
        ? {
            label: "Changes not published",
            tone: "waiting",
            hint: "Students still see the version you published.",
          }
        : { label: "Published", tone: "live", hint: null };
    case "archived":
      return { label: "Archived", tone: "stopped", hint: "Put away. Students cannot see it." };
    case "draft":
    default:
      return { label: "Draft", tone: "neutral", hint: "Only you can see this." };
  }
}

/* ========================================================================== *
 * What a teacher may do to it                                                 *
 * ========================================================================== */

export type ProgramAction = "publish" | "unpublish" | "archive" | "restore" | "delete";

export interface ProgramActionOffer {
  action: ProgramAction;
  label: string;
  /** Spoken in full. "Archive" alone does not say what happens to the students who saw it. */
  spoken: string;
  emphasis: "primary" | "secondary" | "quiet" | "danger";
  /** True when pressing it needs confirming first. Publishing and archiving both change the world. */
  confirm: boolean;
}

/**
 * Why publication is not available, in a sentence a teacher can act on.
 *
 * Three different situations, and a teacher does something different in each: wait for a review,
 * finish writing, or restore the program first. Collapsing them into one greyed button is the
 * mistake `.agents/memory/refusals-must-name-their-reason.md` was written about.
 */
export type PublishBlock =
  | { blocked: false }
  | { blocked: true; code: "approval"; title: string; body: string }
  | { blocked: true; code: "incomplete"; title: string; body: string }
  | { blocked: true; code: "archived"; title: string; body: string };

export function publishBlock(
  program: { status: ProgramStatus | string; issues: ProgramIssue[] },
  teacher: { approved: boolean },
): PublishBlock {
  if (program.status === "archived") {
    return {
      blocked: true,
      code: "archived",
      title: "This program is archived",
      body: "Restore it before you can publish it again.",
    };
  }
  /*
    Approval comes first, and is checked even when the draft is also incomplete.

    A teacher whose account is in review can finish writing but cannot publish however complete the
    program is, so telling them about a missing outcome first would send them to fix something that
    would not have unblocked them. The server checks approval before validation for the same reason.
  */
  if (!teacher.approved) {
    return {
      blocked: true,
      code: "approval",
      title: "A Fadko operator is still checking your account",
      body:
        "You can write and save as much as you like. Publishing opens once your teacher account " +
        "has been approved — we will let you know.",
    };
  }
  if (program.issues.length > 0) {
    const count = program.issues.length;
    return {
      blocked: true,
      code: "incomplete",
      title: count === 1 ? "One thing left to finish" : `${count} things left to finish`,
      body: "Each one is marked in the section it belongs to.",
    };
  }
  return { blocked: false };
}

/**
 * Everything this program may be asked to do, in the order it should be offered.
 *
 * The list mirrors `api-server/src/lib/learningProgramState.ts` exactly, and mirroring rather than
 * guessing is the point: a teacher pressing something the server will refuse learns to distrust the
 * whole screen.
 *
 * `hasEverPublished` is not the same as "is published now". A program taken down is a draft again,
 * and deleting it would still destroy the record of what students were promised — so the delete is
 * withheld on the *history*, which `version > 0` carries.
 */
export function programActions(program: {
  status: ProgramStatus | string;
  version: number;
  published?: { version: number } | null;
}): ProgramActionOffer[] {
  const hasEverPublished = program.version > 0 || Boolean(program.published);
  const out: ProgramActionOffer[] = [];

  if (program.status === "archived") {
    out.push({
      action: "restore",
      label: "Restore",
      spoken: "Bring this program back as a draft",
      emphasis: "primary",
      confirm: false,
    });
    return out;
  }

  if (program.status === "published") {
    out.push({
      action: "unpublish",
      label: "Take it down",
      spoken: "Remove this program from Fadko. Students will no longer find it",
      emphasis: "secondary",
      confirm: true,
    });
  }

  out.push({
    action: "archive",
    label: "Archive",
    spoken:
      program.status === "published"
        ? "Put this program away and remove it from Fadko"
        : "Put this program away. You can restore it later",
    emphasis: "quiet",
    confirm: true,
  });

  /*
    Deletion is offered only to a program nobody has ever been able to read.

    Everything else is archived instead, and the button is simply not there rather than there and
    refused — a teacher who is offered a delete and then told no has been asked a question the app
    already knew the answer to.
  */
  if (!hasEverPublished) {
    out.push({
      action: "delete",
      label: "Delete",
      spoken: "Delete this draft. It has never been published, so nothing is lost for anybody else",
      emphasis: "danger",
      confirm: true,
    });
  }

  return out;
}

/**
 * What the publish button says, or `null` when there is nothing to publish.
 *
 * A published program whose draft matches what students already see is offered **no publish button
 * at all**. Two wrong answers were tried before this one. The first said "Publish your changes"
 * directly under a line reading "This matches what you have written here" — two statements on one
 * screen that cannot both be true. The second changed the words to "Publish again" and kept the
 * button, on the reasoning that a republish is a harmless no-op.
 *
 * **It is not a no-op.** `api-server/src/routes/learningPrograms.ts` increments `version` and writes
 * a fresh snapshot on every publish, so pressing it would manufacture version 3 of a program that
 * is identical to version 2. The version is the count of times students were given something new;
 * an empty one is a lie in the only record of what was promised.
 */
export function publishOffer(program: {
  status: ProgramStatus | string;
  hasUnpublishedChanges?: boolean;
}): { label: string; spoken: string } | null {
  if (program.status !== "published") {
    return { label: "Publish", spoken: "Publish this program so students can find it" };
  }
  return program.hasUnpublishedChanges
    ? { label: "Publish your changes", spoken: "Publish your changes so students see them" }
    : null;
}

/**
 * What a confirmation sheet says before a lifecycle action happens.
 *
 * `atRisk` is `wouldLoseWork(saveState)`. It changes only the delete sheet, and it has to: every
 * other action is withheld while there is unsaved work, but deleting is *allowed* then, because
 * throwing the draft away is the whole point. What must not happen is a teacher agreeing to discard
 * "this draft" while believing the paragraph they just typed is a separate thing that survives.
 */
export function confirmCopy(
  action: ProgramAction,
  context: { atRisk?: boolean } = {},
): { title: string; body: string; confirm: string } {
  switch (action) {
    case "publish":
      return {
        title: "Publish this program?",
        body: "Students will be able to find it and read exactly what you have written here.",
        confirm: "Publish",
      };
    case "unpublish":
      return {
        title: "Take this program down?",
        body:
          "It goes back to being a draft that only you can see. Your work is kept, and you can " +
          "publish it again whenever you like.",
        confirm: "Take it down",
      };
    case "archive":
      return {
        title: "Archive this program?",
        body: "It is put away and nobody can find it. You can restore it later.",
        confirm: "Archive",
      };
    case "restore":
      return {
        title: "Restore this program?",
        body: "It comes back as a draft. Publishing it again is a separate decision.",
        confirm: "Restore",
      };
    case "delete":
      return {
        title: "Delete this draft?",
        body:
          "This cannot be undone. It has never been published, so nothing is lost for anybody else." +
          (context.atRisk
            ? " Everything on this screen goes too, including the changes you have not saved."
            : ""),
        confirm: "Delete",
      };
  }
}

/* ========================================================================== *
 * Saving                                                                      *
 * ========================================================================== */

/**
 * The four things a save can be, and never a fifth that means "probably fine".
 *
 * `saved` is written only when the API has answered. The brief is explicit and it is the whole
 * reason this is a state machine rather than a boolean: a teacher on a Nepali connection who is
 * told their work is saved and closes the tab has lost it.
 */
export type SaveState = "clean" | "unsaved" | "saving" | "saved" | "failed";

export interface SaveChip {
  label: string;
  tone: ProgramTone;
  /** True when there is work in the editor that the server has not accepted. */
  atRisk: boolean;
}

export function saveChip(state: SaveState): SaveChip {
  switch (state) {
    case "unsaved":
      return { label: "Unsaved changes", tone: "waiting", atRisk: true };
    case "saving":
      return { label: "Saving…", tone: "waiting", atRisk: true };
    case "saved":
      return { label: "Saved", tone: "live", atRisk: false };
    case "failed":
      return { label: "Save failed", tone: "stopped", atRisk: true };
    case "clean":
    default:
      return { label: "All changes saved", tone: "neutral", atRisk: false };
  }
}

/** Whether leaving now would lose typed work. Drives the "you have unsaved changes" guard. */
export function wouldLoseWork(state: SaveState): boolean {
  return saveChip(state).atRisk;
}

/* ========================================================================== *
 * The studio's sections                                                       *
 * ========================================================================== */

export type SectionId =
  | "learn"
  | "who"
  | "path"
  | "requirements"
  | "reference"
  | "review";

export interface StudioField {
  /** The draft key this writes to, which is also the field name the server's issues carry. */
  name: keyof ProgramDraft & string;
  label: string;
  /** One line under the label. Says why the question is being asked, not what to type. */
  help: string | null;
  multiline: boolean;
  required: boolean;
  placeholder?: string;
}

export interface StudioSection {
  id: SectionId;
  title: string;
  /** One sentence a teacher reads before deciding whether this section needs them. */
  blurb: string;
  fields: StudioField[];
}

/**
 * The studio, laid out by what a teacher is thinking about rather than by what the table holds.
 *
 * ## Progressive disclosure is a product rule here, not a nicety
 *
 * The blueprint is explicit: "A guitar teacher, language coach or engineering-registration-exam
 * tutor must not be forced through a school form." So the reference section changes shape with the
 * program type, and for a practical skill it is not shown at all — there is no curriculum to name
 * and a field asking for one is a question with no right answer.
 *
 * The prompts come from `templates` where the server supplies them, because the server owns the
 * wording of what each type is for. Everything structural — which sections exist, which fields sit
 * in them, which are required — is here, and the *validation* of all of it stays on the server.
 */
export function studioSections(
  type: ProgramType | string,
  template?: { promisePrompt?: string; learnerPrompt?: string; referencePrompt?: string | null } | null,
): StudioSection[] {
  const isExam = type === "exam_preparation";
  const isSchool = type === "school_subject";
  const isLanguage = type === "language";
  const isSkill = type === "practical_skill";

  const sections: StudioSection[] = [
    {
      id: "learn",
      title: "What students will learn",
      blurb: "The promise. Write it as something a student will be able to do.",
      fields: [
        {
          name: "title",
          label: "Program name",
          help: "What a student will see first.",
          multiline: false,
          required: true,
          placeholder: "Grade 10 Mathematics, term by term",
        },
        {
          name: "summary",
          label: "Short description",
          help: "A few lines on what the weeks together cover.",
          multiline: true,
          required: true,
        },
        {
          name: "outcome",
          label: "What they will be able to do",
          help: template?.promisePrompt ?? "Describe the result, not the syllabus.",
          multiline: true,
          required: true,
        },
      ],
    },
    {
      id: "who",
      title: "Who it is for",
      blurb: "So a student can tell in one read whether this is right for them.",
      fields: [
        {
          name: "intendedLearner",
          label: "Right for",
          help: template?.learnerPrompt ?? "Who should join, and what they should know already.",
          multiline: true,
          required: true,
          placeholder: isSchool ? "Students in Grade 10" : "Anyone starting out",
        },
        {
          name: "startingLevel",
          label: "Starting level",
          help: isLanguage
            ? "The level a student should already be at — a named framework if you use one."
            : "What a student should be able to do before the first lesson.",
          multiline: false,
          required: true,
          placeholder: isLanguage ? "Can read simple English" : "Complete beginner",
        },
      ],
    },
    {
      id: "path",
      title: "Learning path",
      blurb: "The steps, in the order you will teach them. At least one to publish.",
      fields: [],
    },
    {
      id: "requirements",
      title: "Language and requirements",
      blurb: "What a student needs before they can take part.",
      fields: [
        {
          name: "teachingLanguage",
          label: "Teaching language",
          help: "The language you actually teach in, including a mix.",
          multiline: false,
          required: true,
          placeholder: "Nepali and English",
        },
        {
          name: "prerequisites",
          label: "Anything they must know first",
          help: "Leave empty if there is nothing.",
          multiline: true,
          required: false,
        },
        {
          name: "equipment",
          label: isSkill ? "Equipment they need" : "Anything they need to bring",
          help: isSkill
            ? "Be specific about what a student must already own."
            : "Books, a notebook, software. Leave empty if there is nothing.",
          multiline: true,
          required: false,
          placeholder: isSkill ? "Any acoustic guitar" : undefined,
        },
      ],
    },
  ];

  /*
    The reference section, and the three shapes it takes.

    A practical skill has no curriculum and is not asked for one. A school subject and a language
    may follow one. An exam program *must* name its exam — the server refuses publication without
    it — so it is the only case where the field is required, and the copy says why rather than
    leaving a teacher to guess what "reference" means.
  */
  if (!isSkill) {
    sections.push({
      id: "reference",
      title: isExam ? "Which exam" : "Curriculum or reference",
      blurb: isExam
        ? "Students searching for an exam need to know it is theirs. Name it exactly as it is written on the paper."
        : "If you follow a syllabus or a book, say which. Fadko does not check or endorse it — students are told it is your own citation.",
      fields: [
        {
          name: "referenceName",
          label: isExam ? "The exact exam" : "Curriculum, syllabus or book",
          help: isExam
            ? template?.referencePrompt ?? "The full name of the examination you prepare students for."
            : template?.referencePrompt ?? "Leave empty if you do not follow one.",
          multiline: false,
          required: isExam,
          placeholder: isExam
            ? "Nepal Engineering Council registration examination"
            : "SEE Mathematics syllabus",
        },
      ],
    });
  }

  sections.push({
    id: "review",
    title: "Review and publish",
    blurb: "What students will see, and anything still missing.",
    fields: [],
  });

  return sections;
}

/** Every field name the studio shows for this type. Used to check no issue is left unreachable. */
export function fieldsShownFor(type: ProgramType | string): string[] {
  return studioSections(type).flatMap((section) => section.fields.map((field) => field.name));
}

/* ========================================================================== *
 * Server validation, put where the teacher is looking                         *
 * ========================================================================== */

export interface SectionIssues {
  /** Issues that belong to a field this section draws, keyed by field name. */
  byField: Record<string, ProgramIssue[]>;
  /** Issues that belong to this section but not to one of its fields — the module list's own. */
  loose: ProgramIssue[];
  count: number;
}

/**
 * Put each server issue beside the field that needs attention.
 *
 * The server's `field` is either a draft key (`outcome`) or a path into the module list
 * (`modules.2.title`), and both have somewhere to go. What must never happen is an issue with
 * nowhere to land: a teacher told "one thing left to finish" who cannot find it has been given a
 * puzzle rather than a task, so `unplaced` exists and the review section shows it.
 */
export function placeIssues(
  issues: ProgramIssue[],
  type: ProgramType | string,
): { sections: Record<SectionId, SectionIssues>; modules: Record<number, ProgramIssue[]>; unplaced: ProgramIssue[] } {
  const sections = {} as Record<SectionId, SectionIssues>;
  for (const section of studioSections(type)) {
    sections[section.id] = { byField: {}, loose: [], count: 0 };
  }
  const modules: Record<number, ProgramIssue[]> = {};
  const unplaced: ProgramIssue[] = [];

  const owner = new Map<string, SectionId>();
  for (const section of studioSections(type)) {
    for (const field of section.fields) owner.set(field.name, section.id);
  }

  for (const issue of issues) {
    const moduleMatch = /^modules\.(\d+)(?:\.(.+))?$/.exec(issue.field);
    if (moduleMatch) {
      const index = Number(moduleMatch[1]);
      modules[index] = [...(modules[index] ?? []), issue];
      sections.path.count += 1;
      continue;
    }
    if (issue.field === "modules") {
      sections.path.loose.push(issue);
      sections.path.count += 1;
      continue;
    }
    const sectionId = owner.get(issue.field);
    if (sectionId) {
      const bucket = sections[sectionId];
      bucket.byField[issue.field] = [...(bucket.byField[issue.field] ?? []), issue];
      bucket.count += 1;
      continue;
    }
    /*
      An issue about something this type does not show — a `referenceName` on a practical skill, or
      a `type` the server refused. It cannot be put beside a field that is not drawn, so it is
      carried to the review section rather than dropped.
    */
    unplaced.push(issue);
    sections.review.count += 1;
  }

  return { sections, modules, unplaced };
}

/* ========================================================================== *
 * The module editor                                                           *
 * ========================================================================== */

/**
 * Move one step up or down, and say whether anything moved.
 *
 * Returned as a new array rather than mutated, so a screen can compare it with what it had and know
 * whether it now has unsaved work. Out-of-range moves return the same array — pressing "Move up" on
 * the first step is a no-op, not an error, and the control is disabled anyway.
 */
export function moveModule<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as T);
  return next;
}

export function canMoveUp(index: number): boolean {
  return index > 0;
}

export function canMoveDown(index: number, count: number): boolean {
  return index < count - 1;
}

/** A new, empty step. Empty rather than pre-filled: a placeholder a teacher forgets to edit
 *  becomes a promise nobody meant to make, and the server refuses a blank one at publication. */
export function emptyModule(): ProgramModuleDraft {
  return { title: "", outcome: "", description: null, practicePrompt: null };
}

/**
 * Is there typed work in this editor that the saved copy does not have?
 *
 * Compared field by field at the shape the server stores, so whitespace a teacher added and then
 * removed is not a change — the same rule `hasUnpublishedChanges` uses one layer down, for the same
 * reason: a screen that says "unsaved changes" when nothing changed teaches a teacher to ignore it.
 */
export function draftDiffers(a: ProgramDraft, b: ProgramDraft): boolean {
  return JSON.stringify(normaliseDraft(a)) !== JSON.stringify(normaliseDraft(b));
}

function normaliseDraft(draft: ProgramDraft) {
  const text = (value: string | null | undefined) => (value ?? "").trim();
  return {
    type: draft.type,
    title: text(draft.title),
    summary: text(draft.summary),
    outcome: text(draft.outcome),
    intendedLearner: text(draft.intendedLearner),
    startingLevel: text(draft.startingLevel),
    teachingLanguage: text(draft.teachingLanguage),
    prerequisites: text(draft.prerequisites),
    equipment: text(draft.equipment),
    referenceName: text(draft.referenceName),
    referenceSource: draft.referenceSource,
    modules: draft.modules.map((module) => ({
      title: text(module.title),
      outcome: text(module.outcome),
      description: text(module.description),
      practicePrompt: text(module.practicePrompt),
    })),
  };
}

/**
 * What to send when saving.
 *
 * `referenceSource` is derived rather than asked: a teacher who names a syllabus is making their
 * own citation, and there is no screen in this app on which they could claim an official one. The
 * server carries the distinction to the student verbatim and never promotes it, so deriving
 * `teacher_supplied` here is the honest default and `official` stays reachable only through a
 * separately reviewed claim that does not exist yet.
 */
export function saveBody(draft: ProgramDraft): Record<string, unknown> {
  const named = (draft.referenceName ?? "").trim().length > 0;
  return {
    type: draft.type,
    title: draft.title,
    summary: draft.summary,
    outcome: draft.outcome,
    intendedLearner: draft.intendedLearner,
    startingLevel: draft.startingLevel,
    teachingLanguage: draft.teachingLanguage,
    prerequisites: draft.prerequisites ?? null,
    equipment: draft.equipment ?? null,
    referenceName: draft.referenceName ?? null,
    referenceSource: named ? "teacher_supplied" : "none",
    modules: draft.modules.map((module) => ({
      title: module.title,
      outcome: module.outcome,
      description: module.description ?? null,
      practicePrompt: module.practicePrompt ?? null,
    })),
  };
}

/* ========================================================================== *
 * The list                                                                    *
 * ========================================================================== */

export interface ProgramGroup {
  id: "working" | "live" | "archived";
  title: string;
  programs: ProgramSummary[];
}

/**
 * The teacher's own programs, grouped by what they need to do with them.
 *
 * Not by status: "published with unpublished changes" is something to finish and belongs beside the
 * drafts in a teacher's head, but its status is `published`. The list the server sends carries no
 * `hasUnpublishedChanges`, so this groups on status alone and the studio is where the finer state
 * is drawn — saying so here rather than letting a later reader assume the grouping knows more than
 * it does.
 */
export function groupPrograms(programs: readonly ProgramSummary[]): ProgramGroup[] {
  const working = programs.filter((p) => p.status === "draft");
  const live = programs.filter((p) => p.status === "published");
  const archived = programs.filter((p) => p.status === "archived");
  const groups: ProgramGroup[] = [];
  if (live.length > 0) groups.push({ id: "live", title: "Published", programs: live });
  if (working.length > 0) groups.push({ id: "working", title: "Drafts", programs: working });
  if (archived.length > 0) groups.push({ id: "archived", title: "Archived", programs: archived });
  return groups;
}

/** The name to show for a program that has not been given one yet. Never blank, never invented. */
export function programTitle(program: { title: string | null }): string {
  const title = (program.title ?? "").trim();
  return title.length > 0 ? title : "Untitled program";
}

/** The label for a program type, for a chip on a card. Falls back to the raw value, never to "". */
export function programTypeLabel(type: ProgramType | string): string {
  switch (type) {
    case "school_subject": return "School subject";
    case "exam_preparation": return "Exam preparation";
    case "language": return "Language";
    case "practical_skill": return "Practical skill";
    case "custom": return "Custom";
    default: return type;
  }
}

/**
 * The five choices at the start, each with one sentence saying what it is for.
 *
 * Ordered by how a Nepali teacher is most likely to arrive: school subjects and exam preparation
 * first because they are the largest tuition markets here, then language, then skills, then the
 * escape hatch.
 *
 * This is **presentation only** — the name, the sentence and the icon. What a teacher may actually
 * choose is decided by the server, through `offerableTypes` below. Writing the wording here rather
 * than generating it from the templates means a template gaining a field cannot silently change
 * what the first screen says; letting the server decide availability means the screen cannot offer
 * a kind of program the API would refuse to create.
 */
export interface ProgramTypeChoice {
  type: ProgramType;
  name: string;
  blurb: string;
  icon: string;
}

export const PROGRAM_TYPE_CHOICES: readonly ProgramTypeChoice[] = [
  {
    type: "school_subject",
    name: "School subject",
    blurb: "A subject taught to a grade or level, following a syllabus if you use one.",
    icon: "book-open",
  },
  {
    type: "exam_preparation",
    name: "Exam preparation",
    blurb: "Preparation for one named examination. No promises about results.",
    icon: "edit-3",
  },
  {
    type: "language",
    name: "Language learning",
    blurb: "Speaking, reading or writing a language, from a level students already have.",
    icon: "message-square",
  },
  {
    type: "practical_skill",
    name: "Practical skill",
    blurb: "Something a student will be able to do — an instrument, a craft, a tool.",
    icon: "tool",
  },
  {
    type: "custom",
    name: "Custom program",
    blurb: "Anything else you teach. You define the steps and what finishing means.",
    icon: "compass",
  },
];

/**
 * The choices to draw, given what the server said it can make.
 *
 * The intersection of two lists, in the app's order: a type is offered only if the server returned
 * a template for it **and** this screen knows how to describe it.
 *
 * Both halves matter. Offering a type the server has no template for produces a create request the
 * API refuses, and a teacher who taps a card and gets an error learns to distrust the screen. And a
 * type the server adds that this build has never heard of is skipped rather than drawn as a blank
 * card with an id in it — the app is shipped to phones and will lag the API.
 *
 * A response with nothing recognizable in it returns an empty list, which the chooser draws as a
 * plain "this build is out of step" rather than as an empty page.
 */
export function offerableTypes(fromServer: readonly { type?: unknown }[] | null | undefined): ProgramTypeChoice[] {
  const offered = new Set(
    (fromServer ?? [])
      .map((template) => (typeof template?.type === "string" ? template.type : null))
      .filter((type): type is string => type !== null),
  );
  return PROGRAM_TYPE_CHOICES.filter((choice) => offered.has(choice.type));
}
