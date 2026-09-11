import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  learningProgramBatchLessonsTable,
  learningProgramBatchesTable,
  learningProgramBatchPeriodsTable,
  learningProgramTuitionGroupsTable,
  learningProgramsTable,
  teacherProfilesTable,
  usersTable,
  teachingClassJoiningTable,
} from "@workspace/db";

import { requireAuth } from "../middlewares/requireAuth";
import { recordActivity } from "../lib/activityLog";
import { assertTeacherSchedule, lockTeacherSchedule, teacherScheduleReview } from "../lib/teacherSchedule";
import { publishedSnapshotFor } from "../lib/learningProgramState";
import { batchSnapshot, readBatchSnapshot, sameBatchOffer, validateProgramBatch } from "../lib/programBatches";
import { tuitionPeriod, tuitionPeriodIssues } from "../lib/tuitionPeriods";
import { classJoiningPreview } from "../lib/classJoining";

const router: IRouter = Router();

function readId(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function teacherId(req: Request, res: Response): number | null {
  if (req.user!.role !== "teacher") {
    res.status(403).json({ error: "Only teachers can plan Program batches." });
    return null;
  }
  return req.user!.userId;
}

export async function lessonsFor(batchId: number, reader: { select: typeof db.select } = db) {
  return reader
    .select()
    .from(learningProgramBatchLessonsTable)
    .where(eq(learningProgramBatchLessonsTable.batchId, batchId))
    .orderBy(asc(learningProgramBatchLessonsTable.position));
}

export async function periodFor(batchId: number, reader: { select: typeof db.select } = db) {
  const [row] = await reader.select({ group: learningProgramTuitionGroupsTable, link: learningProgramBatchPeriodsTable })
    .from(learningProgramBatchPeriodsTable)
    .innerJoin(learningProgramTuitionGroupsTable, eq(learningProgramTuitionGroupsTable.id, learningProgramBatchPeriodsTable.groupId))
    .where(eq(learningProgramBatchPeriodsTable.batchId, batchId));
  return row ?? null;
}

export async function ownerBatch(row: typeof learningProgramBatchesTable.$inferSelect, reader: { select: typeof db.select } = db) {
  const [joining] = await reader.select().from(teachingClassJoiningTable).where(eq(teachingClassJoiningTable.batchId, row.id));
  const lessons = await lessonsFor(row.id, reader);
  const linked = await periodFor(row.id, reader);
  const anchor = linked?.group.anchorAt ?? lessons[0]?.startsAt;
  const period = linked && anchor ? tuitionPeriod(linked.group.id, linked.link.periodIndex, anchor) : null;
  const [program] = await reader.select({ version: learningProgramsTable.version, teacherId: learningProgramsTable.teacherId }).from(learningProgramsTable).where(eq(learningProgramsTable.id, row.programId)).limit(1);
  const review = program ? await teacherScheduleReview(reader, program.teacherId, lessons.map((lesson) => ({ ...lesson, label: `Lesson ${lesson.position + 1}` })), { batchId: row.id }) : { issues: [], conflicts: [] };
  return {
    id: row.id,
    programId: row.programId,
    format: linked ? "ongoing" : "fixed",
    allowLateJoining: linked ? joining?.allowLateJoining === true : false,
    tuitionGroupId: linked?.group.id ?? null,
    tuitionPeriod: period,
    periodAnchorLocked: !!linked?.group.anchorAt,
    currentProgramVersion: program?.version ?? null,
    scheduleIssues: [
      ...review.issues,
      ...(period ? tuitionPeriodIssues(period, lessons) : []),
    ],
    scheduleConflicts: review.conflicts,
    status: row.status,
    capacity: row.capacity,
    totalTuitionNpr: row.totalTuitionNpr,
    version: row.version,
    publishedAt: row.publishedAt,
    published: readBatchSnapshot(row.publishedSnapshot),
    lessons: lessons.map((lesson) => ({
      id: lesson.id,
      position: lesson.position,
      startsAt: lesson.startsAt.toISOString(),
      durationMinutes: lesson.durationMinutes,
    })),
    updatedAt: row.updatedAt,
  };
}

async function ownedProgram(programId: number, ownerId: number) {
  const [program] = await db
    .select()
    .from(learningProgramsTable)
    .where(and(eq(learningProgramsTable.id, programId), eq(learningProgramsTable.teacherId, ownerId)))
    .limit(1);
  return program ?? null;
}

router.get("/learning-programs/:programId/batches", requireAuth, async (req, res): Promise<void> => {
  const ownerId = teacherId(req, res);
  if (ownerId === null) return;
  const programId = readId(req.params.programId);
  if (programId === null || !(await ownedProgram(programId, ownerId))) {
    res.status(404).json({ error: "That program was not found." });
    return;
  }
  const rows = await db
    .select()
    .from(learningProgramBatchesTable)
    .where(eq(learningProgramBatchesTable.programId, programId))
    .orderBy(desc(learningProgramBatchesTable.id));
  res.json({ batches: await Promise.all(rows.map((row) => ownerBatch(row))) });
});

router.post("/learning-programs/:programId/batches", requireAuth, async (req, res): Promise<void> => {
  const ownerId = teacherId(req, res);
  if (ownerId === null) return;
  const programId = readId(req.params.programId);
  const program = programId === null ? null : await ownedProgram(programId, ownerId);
  if (!program) {
    res.status(404).json({ error: "That program was not found." });
    return;
  }
  if (program.status !== "published" || !publishedSnapshotFor(program)) {
    res.status(409).json({ error: "Publish the Program before planning a batch." });
    return;
  }
  const format = req.body?.format ?? "fixed";
  if (format !== "fixed" && format !== "ongoing") { res.status(422).json({ error: "Choose ongoing tuition or a fixed course." }); return; }
  const created = await db.transaction(async (tx) => {
    const [batch] = await tx.insert(learningProgramBatchesTable).values({ programId: program.id, status: "draft" }).returning();
    if (format === "ongoing") {
      const [group] = await tx.insert(learningProgramTuitionGroupsTable).values({ programId: program.id }).returning();
      await tx.insert(learningProgramBatchPeriodsTable).values({ batchId: batch!.id, groupId: group!.id, periodIndex: 0 });
    }
    return batch;
  });
  if (!created) {
    res.status(503).json({ error: "Could not start the batch. Please try again." });
    return;
  }
  recordActivity({ userId: ownerId, action: "learning_program_batch.created", subjectType: "learning_program_batch", subjectId: created.id, detail: { programId: program.id } });
  res.status(201).json({ batch: await ownerBatch(created) });
});

async function ownedBatch(req: Request, res: Response) {
  const ownerId = teacherId(req, res);
  if (ownerId === null) return null;
  const id = readId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "That batch address is not valid." });
    return null;
  }
  const [joined] = await db
    .select({ batch: learningProgramBatchesTable, program: learningProgramsTable })
    .from(learningProgramBatchesTable)
    .innerJoin(learningProgramsTable, eq(learningProgramsTable.id, learningProgramBatchesTable.programId))
    .where(eq(learningProgramBatchesTable.id, id))
    .limit(1);
  if (!joined || joined.program.teacherId !== ownerId) {
    res.status(404).json({ error: "That batch was not found." });
    return null;
  }
  return joined;
}

router.get("/learning-program-batches/:id", requireAuth, async (req, res): Promise<void> => {
  const joined = await ownedBatch(req, res);
  if (!joined) return;
  res.json({ batch: await ownerBatch(joined.batch) });
});

router.patch("/learning-program-batches/:id", requireAuth, async (req, res): Promise<void> => {
  const joined = await ownedBatch(req, res);
  if (!joined) return;
  if (joined.batch.status === "closed") {
    res.status(409).json({ error: "A closed batch cannot be edited." });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const validation = validateProgramBatch({
    capacity: body.capacity,
    totalTuitionNpr: body.totalTuitionNpr,
    lessons: body.lessons,
  }, 0);
  if (!validation.ok) {
    res.status(422).json({ error: "Check the batch details.", issues: validation.issues });
    return;
  }
  const updated = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(learningProgramBatchesTable).where(eq(learningProgramBatchesTable.id, joined.batch.id)).for("update");
    if (!locked || locked.status === "closed") return null;
    const rows = await tx
      .update(learningProgramBatchesTable)
      .set({ capacity: validation.capacity, totalTuitionNpr: validation.totalTuitionNpr, updatedAt: new Date() })
      .where(eq(learningProgramBatchesTable.id, joined.batch.id))
      .returning();
    await tx.delete(learningProgramBatchLessonsTable).where(eq(learningProgramBatchLessonsTable.batchId, joined.batch.id));
    await tx.insert(learningProgramBatchLessonsTable).values(
      validation.lessons.map((lesson) => ({ batchId: joined.batch.id, ...lesson })),
    );
    return ownerBatch(rows[0]!, tx);
  });
  if (!updated) {
    res.status(409).json({ error: "This batch was closed. Reload to see its current details." });
    return;
  }
  res.json({ batch: updated });
});

router.post("/learning-program-batches/:id/publish", requireAuth, async (req, res): Promise<void> => {
  const owned = await ownedBatch(req, res);
  if (!owned) return;
  // The same Batch lock as PATCH: read one complete draft, and serialize repeated publication.
  const result = await db.transaction(async (tx) => {
  await lockTeacherSchedule(tx, owned.program.teacherId);
  const [program] = await tx.select().from(learningProgramsTable).where(eq(learningProgramsTable.id, owned.program.id)).for("update");
  const [batch] = await tx.select().from(learningProgramBatchesTable).where(eq(learningProgramBatchesTable.id, owned.batch.id)).for("update");
  if (!program || !batch) { res.status(404).json({ error: "That batch was not found." }); return null; }
  const joined = { program, batch };
  if (joined.batch.status === "closed") {
    res.status(409).json({ error: "A closed batch cannot be published." });
    return;
  }
  const [profile] = await tx
    .select({ approvalStatus: teacherProfilesTable.approvalStatus })
    .from(teacherProfilesTable)
    .where(eq(teacherProfilesTable.userId, joined.program.teacherId))
    .limit(1);
  if (!profile || profile.approvalStatus !== "approved") {
    res.status(403).json({ error: "A Fadko operator must approve your account before a batch can be published." });
    return;
  }
  const programSnapshot = publishedSnapshotFor(joined.program);
  if (joined.program.status !== "published" || !programSnapshot) {
    res.status(409).json({ error: "Publish the Program before publishing its batch." });
    return;
  }
  const lessons = await lessonsFor(joined.batch.id, tx);
  const localParts = lessons.map((lesson) => {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(lesson.startsAt);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", hour: "2-digit", minute: "2-digit", hour12: false }).format(lesson.startsAt);
    return { date, time, durationMinutes: lesson.durationMinutes };
  });
  const input = { capacity: joined.batch.capacity, totalTuitionNpr: joined.batch.totalTuitionNpr, lessons: localParts };
  const validation = validateProgramBatch(input, 0);
  if (!validation.ok) {
    res.status(422).json({ error: "This batch is not ready to publish.", issues: validation.issues });
    return;
  }
  const version = joined.batch.version + 1;
  const linked = await periodFor(batch.id, tx);
  const period = linked ? tuitionPeriod(linked.group.id, linked.link.periodIndex, linked.group.anchorAt ?? validation.lessons[0]!.startsAt) : undefined;
  if (period) {
    const periodProblems = tuitionPeriodIssues(period, validation.lessons);
    if (periodProblems.length) { res.status(422).json({ error: "Check the tuition period dates.", issues: periodProblems }); return null; }
  }
  const [joining] = await tx.select().from(teachingClassJoiningTable).where(eq(teachingClassJoiningTable.batchId, batch.id));
  const snapshot = batchSnapshot({
    allowLateJoining: !!period && joining?.allowLateJoining === true,
    tuitionPeriod: period,
    batchId: joined.batch.id,
    version,
    programId: joined.program.id,
    programVersion: joined.program.version,
    programTitle: programSnapshot.title,
    capacity: validation.capacity,
    totalTuitionNpr: validation.totalTuitionNpr,
    lessons: validation.lessons,
  });
  const previous = readBatchSnapshot(joined.batch.publishedSnapshot);
  if (joined.batch.status === "published" && previous?.version === joined.batch.version && sameBatchOffer(previous, snapshot)) {
    return { batch: await ownerBatch(joined.batch, tx), changed: false };
  }
  const future = validateProgramBatch(input, Date.now());
  if (!future.ok) { res.status(422).json({ error: "This batch is not ready to publish.", issues: future.issues }); return null; }
  if (period && Date.parse(period.startsAt) <= Date.now()) {
    res.status(422).json({ error: "This tuition period has started. Its published offer can no longer change." }); return null;
  }
  await assertTeacherSchedule(tx, joined.program.teacherId, validation.lessons.map((lesson) => ({ ...lesson, label: `Lesson ${lesson.position + 1}` })), { batchId: batch.id });
  if (linked && !linked.group.anchorAt) {
    await tx.update(learningProgramTuitionGroupsTable).set({ anchorAt: validation.lessons[0]!.startsAt }).where(eq(learningProgramTuitionGroupsTable.id, linked.group.id));
  }
  const [updated] = await tx
    .update(learningProgramBatchesTable)
    .set({ status: "published", version, publishedAt: new Date(), publishedSnapshot: snapshot })
    .where(eq(learningProgramBatchesTable.id, joined.batch.id))
    .returning();
  return { batch: await ownerBatch(updated!, tx), changed: true };
  });
  if (!result) return;
  if (result.changed) recordActivity({ userId: owned.program.teacherId, action: "learning_program_batch.published", subjectType: "learning_program_batch", subjectId: owned.batch.id, detail: { programId: owned.program.id, version: result.batch.version } });
  res.json({ batch: result.batch, unchanged: !result.changed });
});

/** Preparation, not enrolment renewal: no money, seats or student access are created. */
router.post("/learning-program-batches/:id/next-period", requireAuth, async (req, res): Promise<void> => {
  const owned = await ownedBatch(req, res);
  if (!owned) return;
  const next = await db.transaction(async (tx) => {
    // Same ordering as publication. Serializes repeats without creating two next periods.
    await lockTeacherSchedule(tx, owned.program.teacherId);
    await tx.select().from(learningProgramsTable).where(eq(learningProgramsTable.id, owned.program.id)).for("update");
    const [source] = await tx.select().from(learningProgramBatchesTable).where(eq(learningProgramBatchesTable.id, owned.batch.id)).for("update");
    const linked = await periodFor(owned.batch.id, tx);
    const published = readBatchSnapshot(source?.publishedSnapshot);
    if (!source || source.status !== "published" || !linked?.group.anchorAt || !published?.tuitionPeriod || linked.link.periodIndex >= 1200) {
      res.status(409).json({ error: "Publish an ongoing tuition period before preparing the next one." }); return null;
    }
    const index = linked.link.periodIndex + 1;
    const [existing] = await tx.select({ batch: learningProgramBatchesTable }).from(learningProgramBatchPeriodsTable)
      .innerJoin(learningProgramBatchesTable, eq(learningProgramBatchesTable.id, learningProgramBatchPeriodsTable.batchId))
      .where(and(eq(learningProgramBatchPeriodsTable.groupId, linked.group.id), eq(learningProgramBatchPeriodsTable.periodIndex, index)));
    if (existing) return { batch: await ownerBatch(existing.batch, tx), created: false };
    const bounds = tuitionPeriod(linked.group.id, index, linked.group.anchorAt);
    if (Date.parse(bounds.startsAt) <= Date.now()) { res.status(409).json({ error: "The next period has already started. Create a new tuition group with a future start date." }); return null; }
    const [created] = await tx.insert(learningProgramBatchesTable).values({ programId: owned.program.id, capacity: published.capacity, totalTuitionNpr: published.totalTuitionNpr }).returning();
    await tx.insert(learningProgramBatchPeriodsTable).values({ batchId: created!.id, groupId: linked.group.id, periodIndex: index });
    return { batch: await ownerBatch(created!, tx), created: true };
  });
  if (!next) return;
  if (next.created) recordActivity({ userId: owned.program.teacherId, action: "learning_program_batch.period_prepared", subjectType: "learning_program_batch", subjectId: next.batch.id, detail: { sourceBatchId: owned.batch.id, groupId: next.batch.tuitionGroupId } });
  res.status(next.created ? 201 : 200).json(next);
});

router.post("/learning-program-batches/:id/close", requireAuth, async (req, res): Promise<void> => {
  const joined = await ownedBatch(req, res);
  if (!joined) return;
  const [updated] = await db
    .update(learningProgramBatchesTable)
    .set({ status: "closed", updatedAt: new Date() })
    .where(eq(learningProgramBatchesTable.id, joined.batch.id))
    .returning();
  recordActivity({ userId: joined.program.teacherId, action: "learning_program_batch.closed", subjectType: "learning_program_batch", subjectId: joined.batch.id, detail: { programId: joined.program.id } });
  res.json({ batch: await ownerBatch(updated!) });
});

router.get("/programs/:programId/batches", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const programId = readId(req.params.programId);
  if (programId === null) {
    res.status(400).json({ error: "That program address is not valid." });
    return;
  }
  const rows = await db
    .select({
      version: learningProgramBatchesTable.version,
      snapshot: learningProgramBatchesTable.publishedSnapshot,
      programVersion: learningProgramsTable.version,
    })
    .from(learningProgramBatchesTable)
    .innerJoin(learningProgramsTable, eq(learningProgramsTable.id, learningProgramBatchesTable.programId))
    .innerJoin(usersTable, eq(usersTable.id, learningProgramsTable.teacherId))
    .innerJoin(teacherProfilesTable, eq(teacherProfilesTable.userId, learningProgramsTable.teacherId))
    .where(and(
      eq(learningProgramBatchesTable.programId, programId),
      eq(learningProgramBatchesTable.status, "published"),
      eq(learningProgramsTable.status, "published"),
      eq(teacherProfilesTable.approvalStatus, "approved"),
      // Keep this in SQL: filtering after a page is fetched can leak or shorten a page.
      isNull(usersTable.suspendedAt),
    ))
    .orderBy(asc(learningProgramBatchesTable.publishedAt));
  const nowMs = Date.now();
  res.json({
    batches: rows.flatMap((row) => {
      const snapshot = readBatchSnapshot(row.snapshot);
      return snapshot && snapshot.version === row.version && snapshot.programVersion === row.programVersion &&
        Date.parse(snapshot.enrollmentClosesAt) > nowMs
        ? [{ ...snapshot, joiningPreview: classJoiningPreview(snapshot, nowMs) }]
        : [];
    }),
  });
});

export default router;
