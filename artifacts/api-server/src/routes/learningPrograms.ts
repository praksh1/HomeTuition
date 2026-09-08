import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  learningProgramModulesTable,
  learningProgramsTable,
  teacherProfilesTable,
  usersTable,
} from "@workspace/db";

import { requireAuth } from "../middlewares/requireAuth";
import { flagContent } from "../lib/moderation";
import { recordActivity } from "../lib/activityLog";
import { validateLearningProgramForPublish, LEARNING_PROGRAM_TEMPLATES } from "../lib/learningPrograms";
import {
  draftFrom,
  hasUnpublishedChanges,
  readProgramType,
  readReferenceSource,
  readSnapshot,
  readStatus,
  snapshotOf,
  transition,
  type ProgramAction,
  type ProgramStatus,
} from "../lib/learningProgramState";

/**
 * Learning Programs — the teacher's draft workspace, and the public page a student reads.
 *
 * Phase 1 of `.agents/backlog/2026-09-07-learning-program-managed-marketplace.md`: the promise and
 * the path, stored and read. **No money and no enrolment anywhere in this file.** No price, no fee,
 * no commission, no payout, no seat, no booking. None of those numbers is decided — the backlog
 * lists nine commercial questions still open — and a route that accepted one would be the place a
 * convenient constant got written down and later read as settled.
 *
 * ## Three rules this file exists to hold
 *
 * **Identity is the token's.** `teacherId` is `req.user.userId` at every write. No route reads an
 * owner from a body; there is nowhere for a client to say whose program this is.
 *
 * **A published program is served from its snapshot, never from the editable columns.** So a
 * teacher may keep working on a revision without any of it reaching a student, and "published
 * content is immutable" is a consequence of reading from a different place rather than a rule
 * somebody has to remember at each write site. `learningProgramState.ts` holds that reasoning.
 *
 * **Nothing here infers a claim.** No rating, no enrolment count, no "popular", no "verified", no
 * completion promise, no availability. `.agents/backlog/ui-upgrade-progress.md` records that every
 * screen this app had invented at least one number, and the honest answer for a feature with no
 * students yet is to have nowhere to put one.
 */

const router: IRouter = Router();

/** The most a caller may ask for in one page, and what they get if they ask for nothing. */
const MAX_PAGE = 50;
const DEFAULT_PAGE = 20;

/** As many steps as the pure contract will validate. A body with more is refused, not truncated. */
const MAX_MODULES = 40;
/** Long enough for any honest answer, short enough that a body cannot be used as storage. */
const MAX_FIELD = 4000;

/**
 * A positive integer id, or null.
 *
 * `Number("12abc")` is NaN but `parseInt("12abc")` is 12, and an id that quietly becomes another
 * row's id is the worst kind of malformed input to accept. So the whole string has to be digits.
 */
function readId(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Trimmed text, or null.
 *
 * A non-string is refused rather than coerced: `String(42)` would store "42" as a teacher's
 * outcome, and a number that became a sentence is worse than a refusal. Empty after trimming is
 * null, so "the teacher cleared this box" and "the teacher never filled it in" are one state
 * rather than two that read the same on screen and differently in a query.
 *
 * Absent and explicitly null are both null. The one caller for which those differ — the patch
 * route, where absent means "leave this alone" — checks for `undefined` before calling.
 */
function readText(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  if (raw.length > MAX_FIELD) return { ok: false };
  const trimmed = raw.trim();
  return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

interface ModuleInput {
  title: string | null;
  outcome: string | null;
  description: string | null;
  practicePrompt: string | null;
}

/**
 * The ordered steps a teacher sent.
 *
 * Order comes from the array, never from a `position` a client supplies: two steps claiming
 * position 3 is a body a client can send and a state the reader has no honest way to resolve.
 * Rewriting the order from the array makes the sent order the only order there is.
 */
function readModules(raw: unknown): { ok: true; value: ModuleInput[] } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "Steps must be a list." };
  if (raw.length > MAX_MODULES) {
    return { ok: false, message: `A program can have at most ${MAX_MODULES} steps.` };
  }
  const out: ModuleInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, message: "Each step must be an object." };
    }
    const e = entry as Record<string, unknown>;
    const title = readText(e.title);
    const outcome = readText(e.outcome);
    const description = readText(e.description);
    const practicePrompt = readText(e.practicePrompt);
    if (!title.ok || !outcome.ok || !description.ok || !practicePrompt.ok) {
      return { ok: false, message: "A step field was not text, or was too long." };
    }
    out.push({
      title: title.value ?? null,
      outcome: outcome.value ?? null,
      description: description.value ?? null,
      practicePrompt: practicePrompt.value ?? null,
    });
  }
  return { ok: true, value: out };
}

/** Every free-text field a teacher wrote, as one string for the existing moderation check. */
function authoredText(
  program: { title: string | null; summary: string | null; outcome: string | null;
    intendedLearner: string | null; startingLevel: string | null; teachingLanguage: string | null;
    prerequisites: string | null; equipment: string | null; referenceName: string | null },
  modules: ModuleInput[],
): string {
  const parts = [
    program.title, program.summary, program.outcome, program.intendedLearner,
    program.startingLevel, program.teachingLanguage, program.prerequisites,
    program.equipment, program.referenceName,
  ];
  for (const m of modules) parts.push(m.title, m.outcome, m.description, m.practicePrompt);
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");
}

async function modulesFor(programId: number) {
  return db
    .select({
      id: learningProgramModulesTable.id,
      position: learningProgramModulesTable.position,
      title: learningProgramModulesTable.title,
      outcome: learningProgramModulesTable.outcome,
      description: learningProgramModulesTable.description,
      practicePrompt: learningProgramModulesTable.practicePrompt,
    })
    .from(learningProgramModulesTable)
    .where(eq(learningProgramModulesTable.programId, programId))
    .orderBy(asc(learningProgramModulesTable.position));
}

/**
 * One program, in the shape its owner sees.
 *
 * Carries both halves and says which is which: the draft the teacher is editing, and the version
 * students can see. `hasUnpublishedChanges` is derived from comparing the two rather than stored,
 * because a stored flag is a second source of truth and the drift always ends with somebody being
 * told the wrong thing about their own work.
 */
async function ownerView(row: typeof learningProgramsTable.$inferSelect) {
  const modules = await modulesFor(row.id);
  const draft = draftFrom(row, modules);
  const published = readSnapshot(row.publishedSnapshot);
  return {
    id: row.id,
    status: row.status,
    type: row.type,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    draft: { ...draft, modules: modules.map((m, i) => ({ ...draft.modules[i], id: m.id })) },
    /** What the validator would say if this were published now. Empty means it may be. */
    issues: validateLearningProgramForPublish(draft),
    published,
    hasUnpublishedChanges: hasUnpublishedChanges(draft, published),
  };
}

/* ------------------------------------------------------------------------- */
/* The teacher's own programs                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Refuses anybody who is not a teacher, and says which door they are at.
 *
 * The role is the token's; a student's token cannot become a teacher's by sending a body. There is
 * deliberately no operator-approval or paid-plan gate on *writing a draft*: a draft is private to
 * its author and reaches nobody. Approval is checked where it matters — at publication, and again
 * in the public read — so a teacher can prepare their program while their account is in review
 * rather than being kept waiting to start writing.
 */
function teacherOnly(req: Request, res: Response): number | null {
  const user = req.user!;
  if (user.role !== "teacher") {
    res.status(403).json({ error: "Only teachers have Learning Programs." });
    return null;
  }
  return user.userId;
}

/** The templates the builder prompts from. Static, honest prompts; they fill in no claim. */
router.get("/learning-programs/templates", (_req: Request, res: Response): void => {
  res.json({ templates: LEARNING_PROGRAM_TEMPLATES });
});

/**
 * The teacher's own list, newest first, paginated by id.
 *
 * Keyset rather than offset: a teacher writing a program while paging would otherwise see a row
 * twice or miss one, and `WHERE id < cursor` cannot do either. The `status` filter accepts only the
 * three real states, so a typo returns a refusal rather than silently listing everything.
 */
router.get("/learning-programs", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const teacherId = teacherOnly(req, res);
  if (teacherId === null) return;

  const limit = Math.min(MAX_PAGE, Math.max(1, Number(req.query.limit) || DEFAULT_PAGE));
  const cursor = req.query.cursor === undefined ? null : readId(String(req.query.cursor));
  if (req.query.cursor !== undefined && cursor === null) {
    res.status(400).json({ error: "That page marker is not valid." });
    return;
  }
  let status: ProgramStatus | null = null;
  if (req.query.status !== undefined) {
    status = readStatus(String(req.query.status));
    if (status === null) {
      res.status(400).json({ error: "Filter by draft, published or archived." });
      return;
    }
  }

  const where = [eq(learningProgramsTable.teacherId, teacherId)];
  if (status !== null) where.push(eq(learningProgramsTable.status, status));
  if (cursor !== null) where.push(lt(learningProgramsTable.id, cursor));

  const rows = await db
    .select({
      id: learningProgramsTable.id,
      status: learningProgramsTable.status,
      type: learningProgramsTable.type,
      title: learningProgramsTable.title,
      version: learningProgramsTable.version,
      updatedAt: learningProgramsTable.updatedAt,
      publishedAt: learningProgramsTable.publishedAt,
    })
    .from(learningProgramsTable)
    .where(and(...where))
    .orderBy(desc(learningProgramsTable.id))
    // One more than asked for, so "is there another page" is known rather than guessed.
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  res.json({
    programs: page,
    nextCursor: rows.length > limit ? String(page[page.length - 1]?.id) : null,
  });
});

/**
 * Start a program.
 *
 * The type is the only required field, and it is required because it decides which template a
 * teacher is prompted with and which rules publication will apply — an exam-preparation program
 * must name its exam, and a guitar program must not be pushed through a school form. Everything
 * else may arrive later; saving an incomplete draft is explicitly allowed.
 */
router.post("/learning-programs", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const teacherId = teacherOnly(req, res);
  if (teacherId === null) return;

  const type = readProgramType((req.body as Record<string, unknown>)?.type);
  if (type === null) {
    res.status(400).json({ error: "Choose what kind of program this is.", field: "type" });
    return;
  }

  const [created] = await db
    .insert(learningProgramsTable)
    // Ownership, status and both timestamps are the server's. Nothing from the body decides them.
    .values({ teacherId, type, status: "draft" })
    .returning();
  if (!created) {
    res.status(503).json({ error: "Could not start the program. Please try again." });
    return;
  }

  recordActivity({
    userId: teacherId,
    action: "learning_program.created",
    subjectType: "learning_program",
    subjectId: created.id,
    detail: { type },
  });
  res.status(201).json({ program: await ownerView(created) });
});

/** Load one of the caller's own programs, or answer the refusal. Never leaks another teacher's. */
async function ownedProgram(
  req: Request,
  res: Response,
): Promise<typeof learningProgramsTable.$inferSelect | null> {
  const teacherId = teacherOnly(req, res);
  if (teacherId === null) return null;

  const id = readId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "That program address is not valid." });
    return null;
  }

  const [row] = await db
    .select()
    .from(learningProgramsTable)
    .where(eq(learningProgramsTable.id, id))
    .limit(1);

  /*
    One answer for "no such program" and for "somebody else's program".

    Telling them apart would let anybody walk the id space and learn how many programs exist and
    which ids are taken — the same reasoning `requireAdmin` gives for answering every unauthorised
    request identically.
  */
  if (!row || row.teacherId !== teacherId) {
    res.status(404).json({ error: "That program was not found." });
    return null;
  }
  return row;
}

/** The teacher's own view: the draft, the published version if there is one, and what is missing. */
router.get("/learning-programs/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const row = await ownedProgram(req, res);
  if (!row) return;
  res.json({ program: await ownerView(row) });
});

/**
 * Save the draft.
 *
 * Incomplete is fine and is the ordinary case — a program is written over several sittings. What
 * this refuses is input that is not *readable*: a type this build does not know, a reference source
 * outside the three, a step that is not an object. Publication is where completeness is judged.
 *
 * Modules are replaced wholesale rather than patched. A partial module update needs a stable id per
 * step and a merge rule, and both are Phase 2 problems; rewriting the list is unambiguous, and the
 * order the teacher sent is the order that is stored.
 */
router.patch("/learning-programs/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const row = await ownedProgram(req, res);
  if (!row) return;

  const move = transition(row.status as ProgramStatus, "save");
  if (!move.ok) {
    res.status(409).json({ error: move.reason, code: move.code });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  let type = row.type;
  if (body.type !== undefined) {
    const read = readProgramType(body.type);
    if (read === null) {
      res.status(400).json({ error: "That is not a kind of program this app knows.", field: "type" });
      return;
    }
    type = read;
  }

  let referenceSource = row.referenceSource;
  if (body.referenceSource !== undefined) {
    const read = readReferenceSource(body.referenceSource);
    if (read === null) {
      res.status(400).json({
        error: "Say whether the reference is official, your own, or that there is none.",
        field: "referenceSource",
      });
      return;
    }
    referenceSource = read;
  }

  const textFields = [
    "title", "summary", "outcome", "intendedLearner", "startingLevel",
    "teachingLanguage", "prerequisites", "equipment", "referenceName",
  ] as const;
  const patch: Record<string, string | null> = {};
  for (const field of textFields) {
    if (body[field] === undefined) continue;
    const read = readText(body[field]);
    if (!read.ok) {
      res.status(400).json({ error: "That answer was not text, or was too long.", field });
      return;
    }
    patch[field] = read.value;
  }

  const modules = readModules(body.modules);
  if (!modules.ok) {
    res.status(400).json({ error: modules.message, field: "modules" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(learningProgramsTable)
      .set({ ...patch, type, referenceSource })
      .where(eq(learningProgramsTable.id, row.id));

    if (body.modules !== undefined) {
      await tx
        .delete(learningProgramModulesTable)
        .where(eq(learningProgramModulesTable.programId, row.id));
      if (modules.value.length > 0) {
        await tx.insert(learningProgramModulesTable).values(
          // `position` is the array index and nothing else: dense, 0-based, and the sent order.
          modules.value.map((m, position) => ({ programId: row.id, position, ...m })),
        );
      }
    }
  });

  /*
    The same moderation this app already runs on a bio, a class title and a message.

    Deliberately not a second profanity system, and deliberately not a gate: `flagContent` records
    a flag for a human to read and returns whether it matched. A teacher is not blocked mid-sentence
    by a word list, and an operator sees what was written. The publish validator is the thing that
    refuses, and it refuses claims rather than vocabulary.
  */
  const [fresh] = await db
    .select()
    .from(learningProgramsTable)
    .where(eq(learningProgramsTable.id, row.id))
    .limit(1);
  if (!fresh) {
    res.status(404).json({ error: "That program was not found." });
    return;
  }
  await flagContent({
    userId: fresh.teacherId,
    surface: "learning_program",
    subjectId: fresh.id,
    text: authoredText(fresh, modules.value),
  });

  res.json({ program: await ownerView(fresh) });
});

/**
 * Publish, or say exactly what is missing.
 *
 * Two doors, and they are different questions. The *content* must satisfy the pure contract —
 * `validateLearningProgramForPublish`, which is where an exam program is made to name its exam and
 * a guaranteed pass is refused. The *account* must have been reviewed, because publishing is what
 * puts a teacher in front of students; a program written by an unreviewed account stays a draft.
 *
 * Note what is deliberately **not** a door: a paid teaching plan. A plan is what lets somebody run
 * classes, and no commercial rule about programs has been approved — so requiring one here would be
 * inventing a price gate the owner has not agreed to.
 */
router.post("/learning-programs/:id/publish", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const row = await ownedProgram(req, res);
  if (!row) return;

  const move = transition(row.status as ProgramStatus, "publish");
  if (!move.ok) {
    res.status(409).json({ error: move.reason, code: move.code });
    return;
  }

  const [profile] = await db
    .select({ approvalStatus: teacherProfilesTable.approvalStatus })
    .from(teacherProfilesTable)
    .where(eq(teacherProfilesTable.userId, row.teacherId))
    .limit(1);
  if (!profile || profile.approvalStatus !== "approved") {
    res.status(403).json({
      error: "A Fadko operator must approve your teacher account before your program can be published.",
      code: "OPERATOR_REVIEW",
    });
    return;
  }

  const modules = await modulesFor(row.id);
  const draft = draftFrom(row, modules);
  const issues = validateLearningProgramForPublish(draft);
  if (issues.length > 0) {
    // The validator's own sentences, verbatim. A generic "check your program" would send a teacher
    // hunting for the field this list already names.
    res.status(422).json({ error: "This program is not ready to publish yet.", issues });
    return;
  }

  const version = row.version + 1;
  const snapshot = snapshotOf(draft, version);
  const [updated] = await db
    .update(learningProgramsTable)
    .set({
      status: "published",
      version,
      publishedAt: new Date(),
      publishedSnapshot: snapshot,
      archivedAt: null,
    })
    .where(eq(learningProgramsTable.id, row.id))
    .returning();
  if (!updated) {
    res.status(503).json({ error: "Could not publish. Please try again." });
    return;
  }

  recordActivity({
    userId: row.teacherId,
    action: "learning_program.published",
    subjectType: "learning_program",
    subjectId: row.id,
    detail: { version },
  });
  res.json({ program: await ownerView(updated) });
});

/**
 * Take it down, put it away, or bring it back — three named moves, one shape.
 *
 * The transitions live in `learningProgramState.ts` so that "restore returns to draft, never
 * straight to published" is a rule with a test rather than a line in a handler. The snapshot is
 * kept through all of them: a student who read a program and later disputes what was promised needs
 * that page to still exist, so nothing here erases what was published.
 */
for (const [path, action] of [
  ["unpublish", "unpublish"],
  ["archive", "archive"],
  ["restore", "restore"],
] as const satisfies readonly (readonly [string, ProgramAction])[]) {
  router.post(`/learning-programs/:id/${path}`, requireAuth, async (req: Request, res: Response): Promise<void> => {
    const row = await ownedProgram(req, res);
    if (!row) return;

    const move = transition(row.status as ProgramStatus, action);
    if (!move.ok) {
      res.status(409).json({ error: move.reason, code: move.code });
      return;
    }

    const [updated] = await db
      .update(learningProgramsTable)
      .set({
        status: move.next as ProgramStatus,
        archivedAt: move.next === "archived" ? new Date() : null,
      })
      .where(eq(learningProgramsTable.id, row.id))
      .returning();
    if (!updated) {
      res.status(503).json({ error: "Could not change the program. Please try again." });
      return;
    }

    recordActivity({
      userId: row.teacherId,
      action: `learning_program.${action}`,
      subjectType: "learning_program",
      subjectId: row.id,
    });
    res.json({ program: await ownerView(updated) });
  });
}

/**
 * Delete a draft that was never published.
 *
 * Anything that has been public is archived instead, and the refusal says so. Somebody may have
 * read it and enrolled on the strength of it, and deleting the page would destroy the only record
 * of what was promised — which is the one thing a refund argument turns on.
 */
router.delete("/learning-programs/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const row = await ownedProgram(req, res);
  if (!row) return;

  const move = transition(row.status as ProgramStatus, "delete", {
    // Never published *now* is not the same as never published *ever*; a version above zero is the
    // fact that survives being taken down.
    hasEverPublished: row.version > 0 || row.publishedSnapshot !== null,
  });
  if (!move.ok) {
    res.status(409).json({ error: move.reason, code: move.code });
    return;
  }

  // The modules go with it: the foreign key cascades, and a step with no program is not a row
  // anything can read.
  await db.delete(learningProgramsTable).where(eq(learningProgramsTable.id, row.id));
  recordActivity({
    userId: row.teacherId,
    action: "learning_program.deleted",
    subjectType: "learning_program",
    subjectId: row.id,
  });
  res.json({ deleted: true });
});

/* ------------------------------------------------------------------------- */
/* What anybody may read                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Two conditions, and both are checked in the query rather than after it.
 *
 * A program is public when it is published **and** its teacher's account has been approved and is
 * not suspended. Filtering in SQL rather than in JavaScript is deliberate: a filter applied after
 * the page has been cut returns short pages that look like the end of the list, and a filter
 * somebody forgets to apply is a draft on the internet.
 */
const publiclyVisible = () =>
  and(
    eq(learningProgramsTable.status, "published"),
    eq(teacherProfilesTable.approvalStatus, "approved"),
    sql`${usersTable.suspendedAt} is null`,
  );

/**
 * The public list.
 *
 * Ordered newest-published first, keyset-paginated on id. Filterable by program type, which is the
 * one filter that is a *fact* about a program — there is no rating to sort by, no enrolment count,
 * and nothing this app could honestly call popular. The backlog's Discover integration will read
 * this endpoint; it is shaped now so that it never has to grow a "top pick" that means `rows[0]`.
 */
router.get("/programs", async (req: Request, res: Response): Promise<void> => {
  const limit = Math.min(MAX_PAGE, Math.max(1, Number(req.query.limit) || DEFAULT_PAGE));
  const cursor = req.query.cursor === undefined ? null : readId(String(req.query.cursor));
  if (req.query.cursor !== undefined && cursor === null) {
    res.status(400).json({ error: "That page marker is not valid." });
    return;
  }

  let types: string[] | null = null;
  if (req.query.type !== undefined) {
    const asked = String(req.query.type).split(",").map((t) => t.trim()).filter(Boolean);
    const read = asked.map(readProgramType);
    if (read.length === 0 || read.some((t) => t === null)) {
      res.status(400).json({ error: "That is not a kind of program this app knows." });
      return;
    }
    types = read as string[];
  }

  const where = [publiclyVisible()];
  if (types !== null) where.push(inArray(learningProgramsTable.type, types));
  if (cursor !== null) where.push(lt(learningProgramsTable.id, cursor));

  const rows = await db
    .select({
      id: learningProgramsTable.id,
      type: learningProgramsTable.type,
      version: learningProgramsTable.version,
      publishedAt: learningProgramsTable.publishedAt,
      snapshot: learningProgramsTable.publishedSnapshot,
      teacherId: learningProgramsTable.teacherId,
      teacherName: usersTable.name,
    })
    .from(learningProgramsTable)
    .innerJoin(usersTable, eq(usersTable.id, learningProgramsTable.teacherId))
    .innerJoin(teacherProfilesTable, eq(teacherProfilesTable.userId, learningProgramsTable.teacherId))
    .where(and(...where))
    .orderBy(desc(learningProgramsTable.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  res.json({
    programs: page.flatMap((row) => {
      const snapshot = readSnapshot(row.snapshot);
      // A snapshot this build cannot read is left out of the list rather than rendered half-empty.
      // A program page missing its outcome looks like a teacher who did not bother.
      if (!snapshot) return [];
      return [{
        id: row.id,
        type: row.type,
        version: row.version,
        publishedAt: row.publishedAt,
        teacher: { id: row.teacherId, name: row.teacherName },
        title: snapshot.title,
        summary: snapshot.summary,
        outcome: snapshot.outcome,
        startingLevel: snapshot.startingLevel,
        teachingLanguage: snapshot.teachingLanguage,
        referenceName: snapshot.referenceName,
        referenceSource: snapshot.referenceSource,
        moduleCount: snapshot.modules.length,
      }];
    }),
    nextCursor: rows.length > limit ? String(page[page.length - 1]?.id) : null,
  });
});

/**
 * One published program, exactly as it was published.
 *
 * Served from the snapshot, so a teacher's unpublished edits are invisible here however long they
 * have been saved. A draft, an archived program, or a program whose teacher is not approved
 * answers 404 — the same answer as an id that never existed, because "this exists but you may not
 * see it" tells a stranger the id space.
 */
router.get("/programs/:id", async (req: Request, res: Response): Promise<void> => {
  const id = readId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "That program address is not valid." });
    return;
  }

  const [row] = await db
    .select({
      id: learningProgramsTable.id,
      type: learningProgramsTable.type,
      version: learningProgramsTable.version,
      publishedAt: learningProgramsTable.publishedAt,
      snapshot: learningProgramsTable.publishedSnapshot,
      teacherId: learningProgramsTable.teacherId,
      teacherName: usersTable.name,
    })
    .from(learningProgramsTable)
    .innerJoin(usersTable, eq(usersTable.id, learningProgramsTable.teacherId))
    .innerJoin(teacherProfilesTable, eq(teacherProfilesTable.userId, learningProgramsTable.teacherId))
    .where(and(eq(learningProgramsTable.id, id), publiclyVisible()))
    .limit(1);

  const snapshot = row ? readSnapshot(row.snapshot) : null;
  if (!row || !snapshot) {
    res.status(404).json({ error: "That program was not found." });
    return;
  }

  /*
    `type` and `version` come from the snapshot, not from the row's columns.

    They agree today — publication writes both — but only one of them is the frozen copy, and the
    rule this whole file rests on is that a student reads the frozen copy. Listing them separately
    here would have made the row's columns the source for two fields and the snapshot the source
    for the rest, which is exactly the kind of half-and-half a later edit gets wrong.
  */
  res.json({
    program: {
      id: row.id,
      publishedAt: row.publishedAt,
      teacher: { id: row.teacherId, name: row.teacherName },
      ...snapshot,
    },
  });
});

export default router;
