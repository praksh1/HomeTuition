/**
 * What may happen to a Learning Program, and what a student is allowed to see of it.
 *
 * Pure, like `learningPrograms.ts` next door and for the same reason: these are rules about
 * *authority* and *honesty* — who may change a published promise, and whether what a student read
 * last week can be quietly rewritten underneath them. Rules like that are worth nothing unless
 * they are exercised, and a rule that can only be exercised by pointing a browser at a running
 * database is a rule nobody runs.
 *
 * No database, no clock of its own, no Express. The route does the effects.
 *
 * ## The one idea the whole file rests on
 *
 * **A published program is served from its snapshot, never from its editable columns.** A teacher
 * may keep editing after publishing — that is how anybody prepares a revision — and none of it
 * reaches a student until an explicit re-publish, which increments the version. So "published
 * content is immutable" is not a rule somebody has to remember at each write site; it is a
 * consequence of reading from a different place.
 */
import {
  PROGRAM_TYPES,
  validateLearningProgramForPublish,
  type LearningProgramDraft,
  type LearningProgramModuleDraft,
  type LearningProgramType,
  type ReferenceSource,
} from "./learningPrograms.ts";

export const LEARNING_PROGRAM_STATUSES = ["draft", "published", "archived"] as const;
export type ProgramStatus = (typeof LEARNING_PROGRAM_STATUSES)[number];

/* ------------------------------------------------------------------------- */
/* Reading what a client sent                                                 */
/* ------------------------------------------------------------------------- */

/**
 * A program type, or null.
 *
 * The refusal the brief asks for by name. A type this build does not know is not a program it can
 * validate, template, or honestly describe to a student — so it is refused at the door rather
 * than stored and discovered later. `PROGRAM_TYPES` is the single list; adding a sixth type is a
 * deliberate edit there, not something a request body can do.
 */
export function readProgramType(raw: unknown): LearningProgramType | null {
  return typeof raw === "string" && (PROGRAM_TYPES as readonly string[]).includes(raw)
    ? (raw as LearningProgramType)
    : null;
}

const REFERENCE_SOURCES: readonly ReferenceSource[] = ["official", "teacher_supplied", "none"];

/**
 * A reference source, or null.
 *
 * Refused rather than defaulted, because the safe-looking default is the dishonest one in one
 * direction and useless in the other: silently storing `none` would erase a teacher's real
 * citation, and silently storing `official` would have Fadko endorsing a syllabus nobody checked.
 */
export function readReferenceSource(raw: unknown): ReferenceSource | null {
  return typeof raw === "string" && REFERENCE_SOURCES.includes(raw as ReferenceSource)
    ? (raw as ReferenceSource)
    : null;
}

export function readStatus(raw: unknown): ProgramStatus | null {
  return typeof raw === "string" && (LEARNING_PROGRAM_STATUSES as readonly string[]).includes(raw)
    ? (raw as ProgramStatus)
    : null;
}

/* ------------------------------------------------------------------------- */
/* The state machine                                                          */
/* ------------------------------------------------------------------------- */

export type ProgramAction = "save" | "publish" | "unpublish" | "archive" | "restore" | "delete";

export type TransitionResult =
  /** `next` is null for the one action that leaves no row behind. */
  | { ok: true; next: ProgramStatus | null; bumpsVersion: boolean }
  | { ok: false; code: string; reason: string };

const no = (code: string, reason: string): TransitionResult => ({ ok: false, code, reason });

/**
 * May this program move this way, and where does it land?
 *
 * Every refusal names its own situation. `.agents/memory/refusals-must-name-their-reason.md` is
 * about two staging defects with one shape — a true-looking sentence about the wrong thing — and
 * the fix each time was to make the check say *which* case it hit rather than return a boolean.
 * "That is not allowed" would send a teacher looking for a permission problem when what they have
 * is an archived program.
 *
 * `hasEverPublished` rather than a second status, because "was public once" is a fact about the
 * past that `status` cannot carry: an unpublished program and a never-published one are both
 * `draft`, and only one of them is safe to delete.
 */
export function transition(
  from: ProgramStatus,
  action: ProgramAction,
  opts: { hasEverPublished: boolean } = { hasEverPublished: false },
): TransitionResult {
  switch (action) {
    case "save":
      /*
        Editing a published program is allowed, and changes nothing a student sees.

        The draft columns are the teacher's workspace; the snapshot is what is public. Refusing
        the edit instead would mean a teacher had to unpublish — taking the program off the site —
        in order to fix a typo in it.
      */
      if (from === "archived") {
        return no("archived", "This program is archived. Restore it before making changes.");
      }
      return { ok: true, next: from, bumpsVersion: false };

    case "publish":
      if (from === "archived") {
        return no("archived", "This program is archived. Restore it before publishing.");
      }
      // From `published` this is a re-publish: the same transition, a new version.
      return { ok: true, next: "published", bumpsVersion: true };

    case "unpublish":
      if (from !== "published") {
        return no("not-published", "This program is not published, so there is nothing to take down.");
      }
      return { ok: true, next: "draft", bumpsVersion: false };

    case "archive":
      /*
        Allowed from anywhere, including from `archived` itself.

        Archiving twice is not a mistake worth an error — a teacher tapping a stale button should
        end up informed rather than scolded, which is the same instinct `/monthly/plan` follows for
        a plan somebody already holds. Archiving a *published* program is how it comes down, so it
        is deliberately not gated on unpublishing first.
      */
      return { ok: true, next: "archived", bumpsVersion: false };

    case "restore":
      if (from !== "archived") {
        return no("not-archived", "This program is not archived.");
      }
      /*
        Back to draft, never straight back to published.

        Restoring is the teacher saying "I want this again", which is not the same as saying "put
        it back in front of students unread". Publishing is its own decision and revalidates.
      */
      return { ok: true, next: "draft", bumpsVersion: false };

    case "delete":
      if (from !== "draft") {
        return no("not-draft", "Only a draft can be deleted. Archive this program instead.");
      }
      if (opts.hasEverPublished) {
        /*
          Somebody may have read it, so it is archived rather than erased.

          A student who enrolled from a program page and later disputes what was promised needs
          that page to still exist. Deleting it would destroy the only record of the promise.
        */
        return no(
          "was-published",
          "This program has been published before, so it is kept. Archive it instead of deleting it.",
        );
      }
      return { ok: true, next: null, bumpsVersion: false };
  }
}

/* ------------------------------------------------------------------------- */
/* Rows in, drafts out                                                        */
/* ------------------------------------------------------------------------- */

/** Only the fields the mapping reads. Keeps this file free of Drizzle's row type. */
export interface ProgramFields {
  type: string;
  title: string | null;
  summary: string | null;
  outcome: string | null;
  intendedLearner: string | null;
  startingLevel: string | null;
  teachingLanguage: string | null;
  prerequisites: string | null;
  equipment: string | null;
  referenceName: string | null;
  referenceSource: string;
}

export interface ModuleFields {
  position: number;
  title: string | null;
  outcome: string | null;
  description: string | null;
  practicePrompt: string | null;
}

/**
 * A stored row, in the shape the pure publish validator understands.
 *
 * NULL becomes `""` rather than being dropped: the validator already treats an empty string as
 * missing and reports `required`, so an unfinished draft produces exactly the list of things left
 * to write. Dropping the key instead would be the same answer by a longer route, and would make
 * the two representations differ for no reason.
 */
export function draftFrom(program: ProgramFields, modules: ModuleFields[]): LearningProgramDraft {
  return {
    // An unreadable type reaches the validator as-is and is refused there with `invalid`. It
    // cannot get in through the routes; a row edited by hand in the database still should not
    // publish.
    type: (readProgramType(program.type) ?? program.type) as LearningProgramType,
    title: program.title ?? "",
    summary: program.summary ?? "",
    outcome: program.outcome ?? "",
    intendedLearner: program.intendedLearner ?? "",
    startingLevel: program.startingLevel ?? "",
    teachingLanguage: program.teachingLanguage ?? "",
    prerequisites: program.prerequisites ?? undefined,
    equipment: program.equipment ?? undefined,
    referenceName: program.referenceName ?? undefined,
    referenceSource: (readReferenceSource(program.referenceSource) ?? "none") as ReferenceSource,
    modules: [...modules]
      .sort((a, b) => a.position - b.position)
      .map<LearningProgramModuleDraft>((m) => ({
        title: m.title ?? "",
        outcome: m.outcome ?? "",
        description: m.description ?? undefined,
        practicePrompt: m.practicePrompt ?? undefined,
      })),
  };
}

/* ------------------------------------------------------------------------- */
/* What a student sees                                                        */
/* ------------------------------------------------------------------------- */

export interface PublishedModule {
  position: number;
  title: string;
  outcome: string;
  description: string | null;
  practicePrompt: string | null;
}

/**
 * The frozen copy of one published version.
 *
 * Note what is *not* here, and it is the point of the type existing at all: no rating, no
 * availability, no "verified", no completion guarantee, no price. `.agents/backlog/ui-upgrade-
 * progress.md` records that every screen this app had invented at least one number; a shape that
 * has nowhere to put one is a shape that cannot.
 */
export interface PublishedProgram {
  version: number;
  type: LearningProgramType;
  title: string;
  summary: string;
  outcome: string;
  intendedLearner: string;
  startingLevel: string;
  teachingLanguage: string;
  prerequisites: string | null;
  equipment: string | null;
  referenceName: string | null;
  /** Carried through exactly as the teacher declared it. Never promoted. */
  referenceSource: ReferenceSource;
  modules: PublishedModule[];
}

const trimmedOrNull = (value: string | undefined | null): string | null => {
  const text = value?.trim() ?? "";
  return text.length > 0 ? text : null;
};

/**
 * Freeze a draft at a version.
 *
 * Called once, at publication, on a draft the validator has already accepted — so every required
 * field is present and trimming cannot empty one. The optional fields become `null` rather than
 * `""` so that "the teacher did not say" is a distinct answer from "the teacher said nothing",
 * and a client rendering it has something to branch on.
 */
export function snapshotOf(draft: LearningProgramDraft, version: number): PublishedProgram {
  return {
    version,
    type: draft.type,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    outcome: draft.outcome.trim(),
    intendedLearner: draft.intendedLearner.trim(),
    startingLevel: draft.startingLevel.trim(),
    teachingLanguage: draft.teachingLanguage.trim(),
    prerequisites: trimmedOrNull(draft.prerequisites),
    equipment: trimmedOrNull(draft.equipment),
    referenceName: trimmedOrNull(draft.referenceName),
    referenceSource: draft.referenceSource,
    modules: draft.modules.map((module, position) => ({
      position,
      title: module.title.trim(),
      outcome: module.outcome.trim(),
      description: trimmedOrNull(module.description),
      practicePrompt: trimmedOrNull(module.practicePrompt),
    })),
  };
}

/**
 * Read a stored snapshot back, or refuse it — and refuse means refuse.
 *
 * The stored value is our own and was written by `snapshotOf`, so this is not defending against a
 * hostile writer. It is defending against **version skew**, which is the realistic failure: a row
 * written by an older deploy, or by a future one this code has not caught up with.
 *
 * ## An earlier version said this and did the opposite
 *
 * It normalised a missing required string to `""`, a missing modules array to `[]`, and a malformed
 * module member to empty title and outcome — so a corrupt snapshot reached `/programs` as a public
 * page with no outcome and no steps, which looks exactly like a teacher who could not be bothered
 * to fill their program in. Codex's first blocking finding, and the test that claimed to cover it
 * never removed a required field, so it passed without exercising its own title.
 *
 * Every check below is therefore a rejection rather than a repair. The last one is the strongest:
 * the reconstructed draft is put back through `validateLearningProgramForPublish`, so anything that
 * could not have been published in the first place cannot be *read* as published either. That
 * closes the whole class rather than the fields somebody happened to think of — if the publish
 * contract gains a rule tomorrow, this gains it too.
 */
export function readSnapshot(raw: unknown): PublishedProgram | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const type = readProgramType(o.type);
  const referenceSource = readReferenceSource(o.referenceSource);
  if (type === null || referenceSource === null) return null;

  /*
    A version is a count of publications, so the first one is 1.

    Zero would mean "published, and never published", and a fraction or a value beyond the safe
    integer range means the number cannot be compared with the row's own version — which is the
    comparison the public routes make before serving anything.
  */
  if (typeof o.version !== "number" || !Number.isSafeInteger(o.version) || o.version < 1) return null;

  /** Required: present, a string, and not blank. Blank is the failure mode being rejected. */
  const required = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value : null;
  /** Optional: absent or null, or a non-blank string. A blank string is malformed, not absent. */
  const optional = (value: unknown): { ok: true; value: string | null } | { ok: false } => {
    if (value === undefined || value === null) return { ok: true, value: null };
    if (typeof value !== "string" || value.trim().length === 0) return { ok: false };
    return { ok: true, value };
  };

  const title = required(o.title);
  const summary = required(o.summary);
  const outcome = required(o.outcome);
  const intendedLearner = required(o.intendedLearner);
  const startingLevel = required(o.startingLevel);
  const teachingLanguage = required(o.teachingLanguage);
  if (
    title === null || summary === null || outcome === null ||
    intendedLearner === null || startingLevel === null || teachingLanguage === null
  ) {
    return null;
  }

  const prerequisites = optional(o.prerequisites);
  const equipment = optional(o.equipment);
  const referenceName = optional(o.referenceName);
  if (!prerequisites.ok || !equipment.ok || !referenceName.ok) return null;

  if (!Array.isArray(o.modules) || o.modules.length === 0) return null;
  const modules: PublishedModule[] = [];
  for (const entry of o.modules) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const m = entry as Record<string, unknown>;
    const moduleTitle = required(m.title);
    const moduleOutcome = required(m.outcome);
    const description = optional(m.description);
    const practicePrompt = optional(m.practicePrompt);
    if (moduleTitle === null || moduleOutcome === null || !description.ok || !practicePrompt.ok) {
      return null;
    }
    if (typeof m.position !== "number" || !Number.isSafeInteger(m.position) || m.position < 0) {
      return null;
    }
    modules.push({
      position: m.position,
      title: moduleTitle,
      outcome: moduleOutcome,
      description: description.value,
      practicePrompt: practicePrompt.value,
    });
  }

  /*
    Dense and unique, checked rather than sorted into looking right.

    A duplicate position is two steps claiming the same place in the path and a gap is a step that
    was lost; either way the order a student would read is not the order that was published, and
    quietly renumbering them would present a guess as the teacher's own sequence.
  */
  const positions = [...modules.map((m) => m.position)].sort((a, b) => a - b);
  if (positions.some((position, index) => position !== index)) return null;
  modules.sort((a, b) => a.position - b.position);

  const snapshot: PublishedProgram = {
    version: o.version,
    type,
    title,
    summary,
    outcome,
    intendedLearner,
    startingLevel,
    teachingLanguage,
    prerequisites: prerequisites.value,
    equipment: equipment.value,
    referenceName: referenceName.value,
    referenceSource,
    modules,
  };

  /*
    The last gate, and the one that does not have to be maintained.

    Everything above is shape. This is *content*: an exam program that names no exam, a summary
    shorter than the contract allows, a guaranteed pass — none of those could have been published,
    so none of them may be read back as published. Running the real validator rather than repeating
    its rules is what keeps the two from drifting apart.
  */
  if (validateLearningProgramForPublish(asDraft(snapshot)).length > 0) return null;

  return snapshot;
}

/** A published snapshot in the shape the publish validator reads. */
function asDraft(snapshot: PublishedProgram): LearningProgramDraft {
  return {
    type: snapshot.type,
    title: snapshot.title,
    summary: snapshot.summary,
    outcome: snapshot.outcome,
    intendedLearner: snapshot.intendedLearner,
    startingLevel: snapshot.startingLevel,
    teachingLanguage: snapshot.teachingLanguage,
    prerequisites: snapshot.prerequisites ?? undefined,
    equipment: snapshot.equipment ?? undefined,
    referenceName: snapshot.referenceName ?? undefined,
    referenceSource: snapshot.referenceSource,
    modules: snapshot.modules.map((module) => ({
      title: module.title,
      outcome: module.outcome,
      description: module.description ?? undefined,
      practicePrompt: module.practicePrompt ?? undefined,
    })),
  };
}

/**
 * The snapshot a student may be served for this row, or null.
 *
 * Two facts have to agree: the snapshot must be readable, and the version written *inside* it must
 * be the version the row says is current. They are written together by one statement, so a
 * disagreement means the row and its snapshot came from different publications — a half-applied
 * write, or a hand-edited row. Serving either half of that is serving a promise nobody made.
 */
export function publishedSnapshotFor(
  row: { version: number; publishedSnapshot: unknown },
): PublishedProgram | null {
  const snapshot = readSnapshot(row.publishedSnapshot);
  if (!snapshot || snapshot.version !== row.version) return null;
  return snapshot;
}

/**
 * Has the teacher changed anything since the version students can see?
 *
 * Derived by comparing the draft to the snapshot rather than stored as a flag, for the reason
 * this codebase keeps arriving at: a stored flag is a second source of truth, and the drift
 * always shows up as somebody being told the wrong thing about their own work. Compared at the
 * *snapshot* shape so that whitespace a teacher added and then removed is not a change.
 *
 * False for a program that has never been published — there is no "since" yet.
 */
export function hasUnpublishedChanges(
  draft: LearningProgramDraft,
  snapshot: PublishedProgram | null,
): boolean {
  if (!snapshot) return false;
  const current = snapshotOf(draft, snapshot.version);
  return JSON.stringify(current) !== JSON.stringify(snapshot);
}
