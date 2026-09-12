import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  learningProgramModulesTable,
  learningProgramsTable,
  teachingClassSetupsTable,
  studentTeacherSubscriptionsTable,
  teacherProfilesTable,
  usersTable,
} from "@workspace/db";

import { requireAuth } from "../middlewares/requireAuth";
import { flagContent } from "../lib/moderation";
import { recordActivity } from "../lib/activityLog";
import { notifyMany, type NotificationEvent } from "../lib/notify";
import { validateLearningProgramForPublish, LEARNING_PROGRAM_TEMPLATES } from "../lib/learningPrograms";
import {
  draftFrom,
  hasUnpublishedChanges,
  readProgramType,
  readReferenceSource,
  publishedSnapshotFor,
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
 * A page size, or null for "that is not a page size".
 *
 * Codex's second smaller correction. It was `Math.min(MAX, Math.max(1, Number(q) || DEFAULT))`,
 * which turned `1.5` into `1.5` and handed a fraction to the database's `LIMIT`, and turned
 * `"lots"` into the default without ever saying the request was wrong. One rule now, and it is
 * stated where it is used: **a whole positive number, capped at the maximum.**
 *
 * Capping rather than refusing a large number is deliberate and is the one place normalisation is
 * kinder than refusal — a client asking for a thousand wants "as many as you will give me", and
 * fifty is that answer. Everything else that is not a whole positive number is refused, because
 * there is no honest guess at what `1.5` or `lots` meant.
 */
function readLimit(raw: unknown): number | null {
  if (raw === undefined) return DEFAULT_PAGE;
  const text = String(raw);
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1) return null;
  return Math.min(MAX_PAGE, value);
}

const LIMIT_REFUSAL = `Ask for a whole number of programs, between 1 and ${MAX_PAGE}.`;

/**
 * A student's search query, made safe before it becomes SQL.
 *
 * Not free-text search over the whole database. This is `ILIKE '%…%'` over a handful of published
 * snapshot fields and the teacher's display name. Every piece of user input goes through a
 * parameter, so the "escape" here is only the two characters `%` and `_` that would otherwise turn
 * the whole query into a match-anything wildcard — and a backslash so that escape itself is
 * literal.
 *
 * Trimmed, then bounded to 80 characters so a hostile client cannot make the server work through a
 * kilobyte of pattern per row. A blank string returns `null`, which the caller reads as "no
 * search"; an over-long query is truncated rather than refused because a teacher's title may
 * legitimately be long and the honest question is still "does this contain what I typed?".
 */
function readSearch(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;
  const capped = trimmed.slice(0, 80);
  const escaped = capped.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

/**
 * A public-list page marker: where a page ended, as `<published_at in ms>_<id>`.
 *
 * Both halves are needed because the list is ordered by publication time first. An id alone cannot
 * resume an ordering it is not the primary key of, which is how the previous cursor could repeat or
 * skip a row the moment two programs were published out of id order.
 */
function readCursor(raw: string): { at: Date; id: number } | null {
  const match = /^(\d+)_(\d+)$/.exec(raw);
  if (!match) return null;
  const at = Number(match[1]);
  const id = Number(match[2]);
  if (!Number.isSafeInteger(at) || !Number.isSafeInteger(id) || id < 1) return null;
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? null : { at: when, id };
}

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

async function modulesFor(programId: number, reader: { select: typeof db.select } = db) {
  return reader
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
async function ownerView(
  row: typeof learningProgramsTable.$inferSelect,
  reader: { select: typeof db.select } = db,
) {
  const modules = await modulesFor(row.id, reader);
  const draft = draftFrom(row, modules);
  const published = publishedSnapshotFor(row);
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

  const limit = readLimit(req.query.limit);
  if (limit === null) {
    res.status(400).json({ error: LIMIT_REFUSAL });
    return;
  }
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
  // New simple classes have their own editor. Do not send them through the older mandatory-path form.
  where.push(sql`not exists (select 1 from ${teachingClassSetupsTable} where ${teachingClassSetupsTable.programId} = ${learningProgramsTable.id})`);
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

/**
 * Everything a program mutation needs, with the row held still while it happens.
 *
 * ## The races this closes
 *
 * Codex's second blocking finding. Every write used to read ownership, status and version *outside*
 * a transaction and then update or delete by id alone, so two requests arriving together could each
 * act on what the other had already changed:
 *
 * - two publishes both read version N and both wrote N+1, so one publication vanished with no
 *   error and the version a student saw did not count the times it had changed;
 * - a save landing between publish's row read and its module read produced a snapshot with one
 *   draft's fields and another draft's steps — a page no teacher ever wrote;
 * - a delete that had read "a draft, never published" raced a publish and erased the newly
 *   published program *and its snapshot*, which is the only record of what was promised;
 * - archive, restore and unpublish applied a transition to a state that had moved on.
 *
 * `SELECT … FOR UPDATE` on the program row is the whole answer, and it is deliberately the *same*
 * lock for every path: the second request waits, then re-reads, then finds the world as it now is.
 * Ownership and the state machine are re-checked **inside** the lock rather than before it, so the
 * decision and the write cannot be about different rows. Publication reads its modules inside the
 * same transaction, so a snapshot is always one whole draft.
 *
 * The cost is that two people editing one program serialise. They are the same person — a teacher
 * with two tabs open — so the wait is microseconds and the alternative is data nobody can explain.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ProgramRow = typeof learningProgramsTable.$inferSelect;
/**
 * What a mutation answers with, and what it wants written down once it has actually happened.
 *
 * `activity` is carried out of the transaction rather than recorded inside it. `recordActivity`
 * writes on its own connection, so a line saying a program was published would survive the
 * transaction that published it being rolled back — a record of something that did not happen,
 * which is the one kind of defect this project has found most often.
 */
type Reply = {
  status: number;
  body: Record<string, unknown>;
  activity?: { userId: number; action: string; subjectId: number; detail?: Record<string, unknown> };
  /** Prepared under the lock, dispatched only after the transaction really committed. */
  notifications?: { userIds: number[]; event: NotificationEvent }[];
};

const notFound: Reply = {
  status: 404,
  // The same answer as somebody else's program. Telling them apart would let anybody walk the id
  // space and learn which ids are taken — the reasoning `requireAdmin` gives for its own 403.
  body: { error: "That program was not found." },
};

/**
 * Read one of the caller's own programs without locking anything. For the read routes only.
 *
 * Nothing here decides a write, so nothing needs the row held: the worst a concurrent change can
 * do to a read is make it a moment old, which is what a read is.
 */
async function ownedProgram(req: Request, res: Response): Promise<ProgramRow | null> {
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

  if (!row || row.teacherId !== teacherId) {
    res.status(notFound.status).json(notFound.body);
    return null;
  }
  return row;
}

/**
 * Run one mutation with the row locked, the owner re-checked and the transition re-decided inside.
 *
 * `work` receives the transaction, the row **as it is under the lock**, and the transition that was
 * allowed from that row — never from whatever the request saw on its way in. A refusal returned
 * from inside is an honest conflict: the state this request expected is no longer the current one.
 */
async function mutate(
  req: Request,
  res: Response,
  action: ProgramAction,
  work: (tx: Tx, row: ProgramRow, next: ProgramStatus | null) => Promise<Reply>,
): Promise<void> {
  const teacherId = teacherOnly(req, res);
  if (teacherId === null) return;

  const id = readId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "That program address is not valid." });
    return;
  }

  const reply = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(learningProgramsTable)
      .where(eq(learningProgramsTable.id, id))
      // Everything below decides on this row, and nothing else may change it until this commits.
      .for("update")
      .limit(1);

    if (!row || row.teacherId !== teacherId) return notFound;

    const [simpleClass] = await tx.select({ id: teachingClassSetupsTable.programId }).from(teachingClassSetupsTable).where(eq(teachingClassSetupsTable.programId, row.id)).limit(1);
    if (simpleClass) return { status: 409, body: { error: "Open this class from My classes to edit or publish it. The older Program editor cannot change it." } };

    const move = transition(row.status as ProgramStatus, action, {
      /*
        Read from the locked row, which is the point.

        "Never published *now*" is not "never published *ever*", and both facts have to come from
        the same instant as the write. A version above zero survives being taken down, so it is what
        a delete has to look at.
      */
      hasEverPublished: row.version > 0 || row.publishedSnapshot !== null,
    });
    if (!move.ok) return { status: 409, body: { error: move.reason, code: move.code } };

    return work(tx, row, move.next);
  });

  if (reply.activity) {
    recordActivity({
      userId: reply.activity.userId,
      action: reply.activity.action,
      subjectType: "learning_program",
      subjectId: reply.activity.subjectId,
      ...(reply.activity.detail ? { detail: reply.activity.detail } : {}),
    });
  }
  for (const notification of reply.notifications ?? []) {
    notifyMany(notification.userIds, notification.event);
  }
  res.status(reply.status).json(reply.body);
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
 *
 * The body is read *before* the lock is taken, so a malformed request never holds a row still while
 * it is refused.
 */
router.patch("/learning-programs/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  let wantedType: string | null = null;
  if (body.type !== undefined) {
    wantedType = readProgramType(body.type);
    if (wantedType === null) {
      res.status(400).json({ error: "That is not a kind of program this app knows.", field: "type" });
      return;
    }
  }

  let wantedReferenceSource: string | null = null;
  if (body.referenceSource !== undefined) {
    wantedReferenceSource = readReferenceSource(body.referenceSource);
    if (wantedReferenceSource === null) {
      res.status(400).json({
        error: "Say whether the reference is official, your own, or that there is none.",
        field: "referenceSource",
      });
      return;
    }
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

  /** Filled in inside the transaction, moderated after it commits. */
  let toModerate: { teacherId: number; programId: number; text: string } | null = null;

  await mutate(req, res, "save", async (tx, row) => {
    /*
      `updatedAt` is always set, and that is not only bookkeeping.

      A save that changes nothing but the steps has no column of its own to write, and Drizzle
      refuses an empty `SET` — which is how a modules-only patch became a 500 the first time this
      was written conditionally. Touching the row is also the truthful answer: the program did
      change, and its "last edited" time should say so whichever half of it the teacher edited.
    */
    await tx
      .update(learningProgramsTable)
      .set({
        ...patch,
        ...(wantedType === null ? {} : { type: wantedType }),
        ...(wantedReferenceSource === null ? {} : { referenceSource: wantedReferenceSource }),
        updatedAt: new Date(),
      })
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

    /*
      Re-read inside the lock, and moderate what is *stored* rather than what was sent.

      Codex's third smaller correction. Moderation used to be handed `modules.value`, which is an
      empty array whenever the request did not carry `modules` — so a teacher fixing one word in
      their title had their whole learning path read as blank, and a flagged step already saved
      would never be looked at again. The scan has to describe the draft as it now stands.
    */
    const [fresh] = await tx
      .select()
      .from(learningProgramsTable)
      .where(eq(learningProgramsTable.id, row.id))
      .limit(1);
    if (!fresh) return notFound;
    const stored = await modulesFor(row.id, tx);
    toModerate = { teacherId: fresh.teacherId, programId: fresh.id, text: authoredText(fresh, stored) };

    return { status: 200, body: { program: await ownerView(fresh, tx) } };
  });

  /*
    Outside the transaction, on purpose.

    `flagContent` writes to another table and swallows its own failures; keeping it out of the lock
    means a slow moderation write cannot hold a teacher's program still. Deliberately **not** a
    gate — it records a flag for an operator to read, and whether an open flag should block
    publication is a product decision nobody has made.
  */
  if (toModerate) {
    const note: { teacherId: number; programId: number; text: string } = toModerate;
    await flagContent({
      userId: note.teacherId,
      surface: "learning_program",
      subjectId: note.programId,
      text: note.text,
    });
  }
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
 *
 * The row, the approval and the modules are all read under the same lock, so the snapshot is one
 * whole draft and the version it is stamped with is the one immediately after the row's own.
 */
router.post("/learning-programs/:id/publish", requireAuth, async (req: Request, res: Response): Promise<void> => {
  await mutate(req, res, "publish", async (tx, row) => {
    const [profile] = await tx
      .select({ approvalStatus: teacherProfilesTable.approvalStatus })
      .from(teacherProfilesTable)
      .where(eq(teacherProfilesTable.userId, row.teacherId))
      .limit(1);
    if (!profile || profile.approvalStatus !== "approved") {
      return {
        status: 403,
        body: {
          error: "A Fadko operator must approve your teacher account before your program can be published.",
          code: "OPERATOR_REVIEW",
        },
      };
    }

    const modules = await modulesFor(row.id, tx);
    const draft = draftFrom(row, modules);
    const issues = validateLearningProgramForPublish(draft);
    if (issues.length > 0) {
      // The validator's own sentences, verbatim. A generic "check your program" would send a
      // teacher hunting for the field this list already names.
      return { status: 422, body: { error: "This program is not ready to publish yet.", issues } };
    }

    const version = row.version + 1;
    const publishedAt = new Date();
    const [updated] = await tx
      .update(learningProgramsTable)
      .set({
        status: "published",
        version,
        publishedAt,
        publishedSnapshot: snapshotOf(draft, version),
        archivedAt: null,
      })
      .where(eq(learningProgramsTable.id, row.id))
      .returning();
    if (!updated) return notFound;

    /*
      A follower hears about a new program once, after the first publication only. Re-publishing
      an edited snapshot is not a new program and must not become notification spam. The follower
      ids and teacher name are read in the transaction, but delivery is carried by `Reply` and
      begins only after commit — a rolled-back publication can never announce something students
      cannot open.
    */
    const firstPublication = row.version === 0 && row.publishedSnapshot === null;
    const followers = firstPublication
      ? await tx
          .select({ studentId: studentTeacherSubscriptionsTable.studentId })
          .from(studentTeacherSubscriptionsTable)
          .where(eq(studentTeacherSubscriptionsTable.teacherId, row.teacherId))
      : [];
    const [teacher] = firstPublication
      ? await tx
          .select({ name: usersTable.name })
          .from(usersTable)
          .where(eq(usersTable.id, row.teacherId))
          .limit(1)
      : [];

    return {
      status: 200,
      body: { program: await ownerView(updated, tx) },
      activity: {
        userId: row.teacherId,
        action: "learning_program.published",
        subjectId: row.id,
        detail: { version },
      },
      ...(firstPublication && followers.length > 0
        ? {
            notifications: [{
              userIds: followers.map((follower) => follower.studentId),
              event: {
                kind: "program_published" as const,
                at: publishedAt.toISOString(),
                fromUserId: row.teacherId,
                fromName: teacher?.name ?? "A teacher you follow",
                programId: row.id,
                programTitle: draft.title ?? "New learning program",
              },
            }],
          }
        : {}),
    };
  });
});

/**
 * Take it down, put it away, or bring it back — three named moves, one shape.
 *
 * The transitions live in `learningProgramState.ts` so that "restore returns to draft, never
 * straight to published" is a rule with a test rather than a line in a handler, and they are
 * decided against the locked row so a request whose expected state has moved on is refused with a
 * conflict rather than applied to whatever it finds. The snapshot is kept through all of them: a
 * student who read a program and later disputes what was promised needs that page to still exist.
 */
for (const [path, action] of [
  ["unpublish", "unpublish"],
  ["archive", "archive"],
  ["restore", "restore"],
] as const satisfies readonly (readonly [string, ProgramAction])[]) {
  router.post(`/learning-programs/:id/${path}`, requireAuth, async (req: Request, res: Response): Promise<void> => {
    await mutate(req, res, action, async (tx, row, next) => {
      const [updated] = await tx
        .update(learningProgramsTable)
        .set({
          status: next as ProgramStatus,
          archivedAt: next === "archived" ? new Date() : null,
        })
        .where(eq(learningProgramsTable.id, row.id))
        .returning();
      if (!updated) return notFound;

      return {
        status: 200,
        body: { program: await ownerView(updated, tx) },
        activity: { userId: row.teacherId, action: `learning_program.${action}`, subjectId: row.id },
      };
    });
  });
}

/**
 * Delete a draft that was never published.
 *
 * Anything that has been public is archived instead, and the refusal says so. Somebody may have
 * read it and enrolled on the strength of it, and deleting the page would destroy the only record
 * of what was promised — which is the one thing a refund argument turns on.
 *
 * The "never published" test is made against the locked row, so a delete that set out while the
 * program was still a draft cannot erase it after somebody published it a moment later. That
 * request gets a conflict, and the newly published program survives.
 */
router.delete("/learning-programs/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  await mutate(req, res, "delete", async (tx, row) => {
    // The modules go with it: the foreign key cascades, and a step with no program is not a row
    // anything can read.
    await tx.delete(learningProgramsTable).where(eq(learningProgramsTable.id, row.id));
    return {
      status: 200,
      body: { deleted: true },
      activity: { userId: row.teacherId, action: "learning_program.deleted", subjectId: row.id },
    };
  });
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
 * Ordered by publication time, newest first, with the id breaking ties — and paginated on that same
 * pair, so the description and the query say the same thing. They did not: the copy claimed
 * "newest-published first" and the query ordered by descending id, which agrees only while nobody
 * ever republishes an older program. Codex's first smaller correction, and the honest fix is the
 * ordering rather than the sentence, because a student browsing programs wants the ones published
 * most recently.
 *
 * A cursor is `<published_at in milliseconds>_<id>`, and the page is everything strictly *after*
 * that pair in the ordering — Postgres compares the row `(published_at, id)` as a whole, so a
 * second program published in the same millisecond is neither skipped nor repeated.
 *
 * Filterable by program type, which is the one filter that is a *fact* about a program: there is no
 * rating to sort by, no enrolment count, and nothing this app could honestly call popular. The
 * backlog's Discover integration will read this endpoint, and it is shaped now so that it never has
 * to grow a "top pick" that means `rows[0]`.
 */
router.get("/programs", async (req: Request, res: Response): Promise<void> => {
  const limit = readLimit(req.query.limit);
  if (limit === null) {
    res.status(400).json({ error: LIMIT_REFUSAL });
    return;
  }

  let cursor: { at: Date; id: number } | null = null;
  if (req.query.cursor !== undefined) {
    cursor = readCursor(String(req.query.cursor));
    if (cursor === null) {
      res.status(400).json({ error: "That page marker is not valid." });
      return;
    }
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

  const search = readSearch(req.query.q);

  let presentation: "all" | "program" | "class" = "all";
  if (req.query.presentation !== undefined) {
    const asked = String(req.query.presentation);
    if (asked !== "program" && asked !== "class") {
      res.status(400).json({ error: "That is not a public catalog this app knows." });
      return;
    }
    presentation = asked;
  }

  let teacherProfileId: number | null = null;
  if (req.query.teacherProfileId !== undefined) {
    teacherProfileId = readId(String(req.query.teacherProfileId));
    if (teacherProfileId === null) {
      res.status(400).json({ error: "That teacher address is not valid." });
      return;
    }
  }

  const where = [publiclyVisible()];
  // Simple Classes reuse an immutable Program snapshot internally, but they are a different
  // product to a student. Keep the endpoint backward compatible by default; explicit catalog
  // readers can prevent the same class appearing in both Discover tabs.
  if (presentation === "program") {
    where.push(sql`coalesce(${learningProgramsTable.publishedSnapshot} ->> 'presentation', 'program') <> 'class'`);
  } else if (presentation === "class") {
    where.push(sql`${learningProgramsTable.publishedSnapshot} ->> 'presentation' = 'class'`);
  }
  if (teacherProfileId !== null) where.push(eq(teacherProfilesTable.id, teacherProfileId));
  if (types !== null) where.push(inArray(learningProgramsTable.type, types));
  if (cursor !== null) {
    where.push(sql`(${learningProgramsTable.publishedAt}, ${learningProgramsTable.id}) < (${cursor.at}, ${cursor.id})`);
  }
  if (search !== null) {
    /*
      The snapshot is stored as JSONB. The `->>` operator reads one text field out of it, which then
      goes through `ilike` with the query as a bound parameter — the same shape the operator search
      in `admin.ts` uses. `escape '\\'` names our escape character so a literal `%` a teacher typed
      into their title matches literally rather than as a wildcard.

      What is searchable is what a student would recognise: the program title, its summary and
      outcome, who it is for, any curriculum/exam reference the teacher supplied, and the teacher's
      display name. `type` matches the label a student would type ("exam preparation"), not the code
      ("exam_preparation").
    */
    const like = sql`ilike ${search} escape '\\'`;
    const snapField = (key: string) =>
      sql`(${learningProgramsTable.publishedSnapshot} ->> ${key}) ${like}`;
    /*
      Type is matched by its student-facing label ("Exam preparation"), not the code, and always
      through the same parameterised `like`. A caller typing "exam prep" finds every exam-prep
      program, without needing to know the internal spelling.
    */
    const typeLabels = ["School subject", "Practical skill", "Language learning", "Exam preparation", "Custom program"] as const;
    where.push(
      or(
        snapField("title"),
        snapField("summary"),
        snapField("outcome"),
        snapField("intendedLearner"),
        snapField("startingLevel"),
        snapField("referenceName"),
        sql`${usersTable.name} ${like}`,
        ...typeLabels.map((label) => sql`${label} ${like}`),
      )!,
    );
  }

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
    .orderBy(desc(learningProgramsTable.publishedAt), desc(learningProgramsTable.id))
    // One more than asked for, so "is there another page" is known rather than guessed.
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  res.json({
    programs: page.flatMap((row) => {
      const snapshot = publishedSnapshotFor({ version: row.version, publishedSnapshot: row.snapshot });
      /*
        A snapshot this build cannot read, or one whose version disagrees with the row's, is left
        out of the list rather than repaired into something that looks like an unfinished program.
        The count of programs on a page can therefore be smaller than the page size; the cursor is
        taken from the last *row* rather than the last rendered program, so paging still advances
        past the unreadable one instead of stopping on it.
      */
      if (!snapshot) return [];
      return [{
        id: row.id,
        type: row.type,
        version: row.version,
        publishedAt: row.publishedAt,
        teacher: { id: row.teacherId, name: row.teacherName },
        title: snapshot.title,
        presentation: snapshot.presentation,
        summary: snapshot.summary,
        outcome: snapshot.outcome,
        /*
          Added in Phase 2B correction round 1. The card's "Who it is for" line was previously
          promised in Phase 2B's initial review and then never drawn because the list did not carry
          it — the client's card fell back to `null`. It is already in the snapshot and search
          already reaches it; there is no reason to hide it from the list.
        */
        intendedLearner: snapshot.intendedLearner,
        startingLevel: snapshot.startingLevel,
        teachingLanguage: snapshot.teachingLanguage,
        referenceName: snapshot.referenceName,
        referenceSource: snapshot.referenceSource,
        moduleCount: snapshot.modules.length,
      }];
    }),
    nextCursor: rows.length > limit && last?.publishedAt ? `${last.publishedAt.getTime()}_${last.id}` : null,
  });
});

/**
 * One published program, exactly as it was published.
 *
 * Served from the snapshot, so a teacher's unpublished edits are invisible here however long they
 * have been saved. A draft, an archived program, a program whose teacher is not approved, or one
 * whose stored snapshot does not survive `publishedSnapshotFor` all answer 404 — the same answer as
 * an id that never existed, because "this exists but you may not see it" tells a stranger the id
 * space, and a program that cannot be read honestly is not a program that should be half-drawn.
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

  const snapshot = row
    ? publishedSnapshotFor({ version: row.version, publishedSnapshot: row.snapshot })
    : null;
  if (!row || !snapshot) {
    res.status(404).json({ error: "That program was not found." });
    return;
  }

  /*
    `type` and `version` come from the snapshot, not from the row's columns.

    They agree — `publishedSnapshotFor` refuses the row outright if the two versions differ — and
    only one of them is the frozen copy. Listing them separately would have made the row the source
    for two fields and the snapshot the source for the rest, which is exactly the kind of
    half-and-half a later edit gets wrong.
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
