import { and, desc, eq, ne, lt } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  db,
  learningProgramsTable,
  learningProgramBatchesTable,
  learningProgramBatchLessonsTable,
  learningProgramTuitionGroupsTable,
  learningProgramBatchPeriodsTable,
  teachingClassSetupsTable,
  teachingClassJoiningTable,
  teacherProfilesTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { readClassDescription } from "../lib/simpleTeachingClass";
import {
  simpleClassSnapshot,
  publishedSnapshotFor,
} from "../lib/learningProgramState";
import {
  batchSnapshot,
  readBatchSnapshot,
  sameBatchOffer,
  validateProgramBatch,
} from "../lib/programBatches";
import { tuitionPeriod, tuitionPeriodIssues } from "../lib/tuitionPeriods";
import {
  assertTeacherSchedule,
  lockTeacherSchedule,
} from "../lib/teacherSchedule";
import { recordActivity } from "../lib/activityLog";
import { flagContent } from "../lib/moderation";
import { ownerBatch, periodFor, lessonsFor } from "./programBatches";

const router = Router();
type Reader = { select: typeof db.select };
function teacher(req: Request, res: Response) {
  if (req.user!.role !== "teacher") {
    res.status(403).json({ error: "Only teachers can create a class." });
    return null;
  }
  return req.user!.userId;
}
async function owned(id: number, teacherId: number, reader: Reader = db) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [row] = await reader
    .select({
      setup: teachingClassSetupsTable,
      program: learningProgramsTable,
      batch: learningProgramBatchesTable,
    })
    .from(learningProgramBatchesTable)
    .innerJoin(
      learningProgramsTable,
      eq(learningProgramsTable.id, learningProgramBatchesTable.programId),
    )
    .innerJoin(
      teachingClassSetupsTable,
      eq(teachingClassSetupsTable.programId, learningProgramsTable.id),
    )
    .where(
      and(
        eq(learningProgramBatchesTable.id, id),
        eq(learningProgramsTable.teacherId, teacherId),
      ),
    );
  return row ?? null;
}
async function view(
  row: NonNullable<Awaited<ReturnType<typeof owned>>>,
  reader: Reader = db,
) {
  return {
    title: row.program.title ?? "",
    summary: row.program.summary ?? "",
    teachingLanguage: row.program.teachingLanguage ?? "",
    outline: row.setup.outline,
    programUpdatedAt: row.program.updatedAt.toISOString(),
    batch: await ownerBatch(row.batch, reader),
    publishedDescription: publishedSnapshotFor(row.program),
  };
}
function input(raw: unknown) {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const description = readClassDescription(body);
  const schedule = validateProgramBatch(
    {
      capacity: body.capacity,
      totalTuitionNpr: body.totalTuitionNpr,
      lessons: body.lessons,
    },
    0,
  );
  return {
    body,
    description,
    schedule,
    issues: [
      ...(description.ok ? [] : description.issues),
      ...(schedule.ok ? [] : schedule.issues),
    ],
  };
}
function activity(userId: number, id: number, action: string) {
  recordActivity({
    userId,
    action,
    subjectType: "learning_program_batch",
    subjectId: id,
  });
}

router.get("/teaching-classes", requireAuth, async (req, res) => {
  const teacherId = teacher(req, res);
  if (teacherId === null) return;
  const before =
    req.query.before === undefined ? null : Number(req.query.before);
  if (before !== null && (!Number.isSafeInteger(before) || before <= 0)) {
    res.status(400).json({ error: "That page address is not valid." });
    return;
  }
  const rows = await db
    .select({
      setup: teachingClassSetupsTable,
      program: learningProgramsTable,
      batch: learningProgramBatchesTable,
    })
    .from(teachingClassSetupsTable)
    .innerJoin(
      learningProgramsTable,
      eq(learningProgramsTable.id, teachingClassSetupsTable.programId),
    )
    .innerJoin(
      learningProgramBatchesTable,
      eq(learningProgramBatchesTable.programId, learningProgramsTable.id),
    )
    .where(
      and(
        eq(learningProgramsTable.teacherId, teacherId),
        before === null
          ? undefined
          : lt(learningProgramBatchesTable.id, before),
      ),
    )
    .orderBy(desc(learningProgramBatchesTable.id))
    .limit(21);
  res.json({
    classes: await Promise.all(rows.slice(0, 20).map((row) => view(row))),
    nextCursor: rows.length > 20 ? rows[19]!.batch.id : null,
  });
});

router.post("/teaching-classes", requireAuth, async (req, res) => {
  const teacherId = teacher(req, res);
  if (teacherId === null) return;
  const checked = input(req.body);
  const { description, schedule, body } = checked;
  if (!description.ok || !schedule.ok || (body.allowLateJoining !== undefined && typeof body.allowLateJoining !== "boolean") || (body.allowLateJoining === true && body.format !== "ongoing")) {
    res
      .status(422)
      .json({ error: "Check your class details.", issues: checked.issues });
    return;
  }
  if (
    !["ongoing", "fixed"].includes(String(body.format)) ||
    typeof body.requestKey !== "string" ||
    !/^[a-zA-Z0-9-]{16,100}$/.test(body.requestKey)
  ) {
    res
      .status(422)
      .json({
        error:
          "Choose regular tuition or a short course, then try saving again.",
      });
    return;
  }
  const result = await db.transaction(async (tx) => {
    await lockTeacherSchedule(tx, teacherId);
    const [existing] = await tx
      .select()
      .from(teachingClassSetupsTable)
      .where(
        and(
          eq(teachingClassSetupsTable.teacherId, teacherId),
          eq(teachingClassSetupsTable.requestKey, body.requestKey as string),
        ),
      );
    if (existing)
      return {
        created: false,
        item: await view(
          (await owned(existing.initialBatchId, teacherId, tx))!,
          tx,
        ),
      };
    const [program] = await tx
      .insert(learningProgramsTable)
      .values({
        teacherId,
        type: "custom",
        title: description.value.title,
        summary: description.value.summary,
        teachingLanguage: description.value.teachingLanguage,
      })
      .returning();
    const [batch] = await tx
      .insert(learningProgramBatchesTable)
      .values({
        programId: program!.id,
        capacity: schedule.capacity,
        totalTuitionNpr: schedule.totalTuitionNpr,
      })
      .returning();
    await tx
      .insert(learningProgramBatchLessonsTable)
      .values(
        schedule.lessons.map((lesson) => ({ batchId: batch!.id, ...lesson })),
      );
    if (body.format === "ongoing") {
      const [group] = await tx
        .insert(learningProgramTuitionGroupsTable)
        .values({ programId: program!.id })
        .returning();
      await tx
        .insert(learningProgramBatchPeriodsTable)
        .values({ batchId: batch!.id, groupId: group!.id, periodIndex: 0 });
    }
    await tx
      .insert(teachingClassSetupsTable)
      .values({
        programId: program!.id,
        teacherId,
        initialBatchId: batch!.id,
        requestKey: body.requestKey as string,
        outline: description.value.outline,
      });
    await tx.insert(teachingClassJoiningTable).values({ batchId: batch!.id, allowLateJoining: body.allowLateJoining === true });
    return {
      created: true,
      item: await view((await owned(batch!.id, teacherId, tx))!, tx),
    };
  });
  if (result.created) {
    activity(teacherId, result.item.batch.id, "teaching_class.created");
    await flagContent({
      userId: teacherId,
      surface: "learning_program",
      subjectId: result.item.batch.programId,
      text: Object.values(description.value).join(" "),
    });
  }
  res.status(result.created ? 201 : 200).json(result);
});

router.get("/teaching-classes/:id", requireAuth, async (req, res) => {
  const teacherId = teacher(req, res);
  if (teacherId === null) return;
  const row = await owned(Number(req.params.id) || 0, teacherId);
  if (!row) {
    res.status(404).json({ error: "That class was not found." });
    return;
  }
  res.json({ item: await view(row) });
});

router.patch("/teaching-classes/:id", requireAuth, async (req, res) => {
  const teacherId = teacher(req, res);
  if (teacherId === null) return;
  const row = await owned(Number(req.params.id) || 0, teacherId);
  if (!row) {
    res.status(404).json({ error: "That class was not found." });
    return;
  }
  const { description, schedule, issues, body } = input(req.body);
  const linked = await periodFor(row.batch.id);
  if (!description.ok || !schedule.ok || (body.allowLateJoining !== undefined && typeof body.allowLateJoining !== "boolean") || (body.allowLateJoining === true && !linked)) {
    res.status(422).json({ error: "Check your class details.", issues });
    return;
  }
  const result = await db.transaction(async (tx) => {
    await lockTeacherSchedule(tx, teacherId);
    const [program] = await tx
      .select()
      .from(learningProgramsTable)
      .where(eq(learningProgramsTable.id, row.program.id))
      .for("update");
    const [batch] = await tx
      .select()
      .from(learningProgramBatchesTable)
      .where(eq(learningProgramBatchesTable.id, row.batch.id))
      .for("update");
    if (!batch || batch.status === "closed" || program?.status === "archived") {
      res
        .status(409)
        .json({
          error:
            "This class is closed or archived. Your entries have not been saved.",
        });
      return null;
    }
    if (
      req.body.expectedUpdatedAt !== batch.updatedAt.toISOString() ||
      req.body.expectedProgramUpdatedAt !== program?.updatedAt.toISOString()
    ) {
      res
        .status(409)
        .json({
          error:
            "This class changed in another window. Reload before editing it again.",
        });
      return null;
    }
    await tx
      .update(learningProgramsTable)
      .set({
        title: description.value.title,
        summary: description.value.summary,
        teachingLanguage: description.value.teachingLanguage,
      })
      .where(eq(learningProgramsTable.id, row.program.id));
    await tx
      .update(teachingClassSetupsTable)
      .set({ outline: description.value.outline })
      .where(eq(teachingClassSetupsTable.programId, row.program.id));
    await tx
      .update(learningProgramBatchesTable)
      .set({
        capacity: schedule.capacity,
        totalTuitionNpr: schedule.totalTuitionNpr,
        updatedAt: new Date(),
      })
      .where(eq(learningProgramBatchesTable.id, batch.id));
    if (body.allowLateJoining !== undefined) {
      await tx.insert(teachingClassJoiningTable).values({ batchId: batch.id, allowLateJoining: body.allowLateJoining === true })
        .onConflictDoUpdate({ target: teachingClassJoiningTable.batchId, set: { allowLateJoining: body.allowLateJoining === true } });
    }
    await tx
      .delete(learningProgramBatchLessonsTable)
      .where(eq(learningProgramBatchLessonsTable.batchId, batch.id));
    await tx
      .insert(learningProgramBatchLessonsTable)
      .values(
        schedule.lessons.map((lesson) => ({ batchId: batch.id, ...lesson })),
      );
    return view((await owned(batch.id, teacherId, tx))!, tx);
  });
  if (!result) return;
  await flagContent({
    userId: teacherId,
    surface: "learning_program",
    subjectId: row.program.id,
    text: Object.values(description.value).join(" "),
  });
  res.json({ item: result });
});

router.post("/teaching-classes/:id/publish", requireAuth, async (req, res) => {
  const teacherId = teacher(req, res);
  if (teacherId === null) return;
  const row = await owned(Number(req.params.id) || 0, teacherId);
  if (!row) {
    res.status(404).json({ error: "That class was not found." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    await lockTeacherSchedule(tx, teacherId);
    const [program] = await tx
      .select()
      .from(learningProgramsTable)
      .where(eq(learningProgramsTable.id, row.program.id))
      .for("update");
    const [batch] = await tx
      .select()
      .from(learningProgramBatchesTable)
      .where(eq(learningProgramBatchesTable.id, row.batch.id))
      .for("update");
    const [setup] = await tx
      .select()
      .from(teachingClassSetupsTable)
      .where(eq(teachingClassSetupsTable.programId, row.program.id));
    const [profile] = await tx
      .select()
      .from(teacherProfilesTable)
      .where(eq(teacherProfilesTable.userId, teacherId));
    const [user] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, teacherId));
    if (
      profile?.approvalStatus !== "approved" ||
      !user ||
      user.suspendedAt !== null ||
      user.role !== "teacher"
    ) {
      res
        .status(403)
        .json({
          error:
            "An active, agent-approved teaching account is required before you publish.",
        });
      return null;
    }
    if (
      !program ||
      !batch ||
      !setup ||
      program.status === "archived" ||
      batch.status === "closed"
    ) {
      res.status(409).json({ error: "This class is closed or archived." });
      return null;
    }
    if (
      req.body.expectedUpdatedAt !== batch.updatedAt.toISOString() ||
      req.body.expectedProgramUpdatedAt !== program.updatedAt.toISOString()
    ) {
      res
        .status(409)
        .json({
          error:
            "This class changed since you reviewed it. Reload and review the current details.",
        });
      return null;
    }
    const description = readClassDescription({
      ...program,
      outline: setup.outline,
    });
    if (!description.ok) {
      res
        .status(422)
        .json({
          error: "Check the class description.",
          issues: description.issues,
        });
      return null;
    }
    const lessons = await lessonsFor(batch.id, tx);
    if (!lessons.length) {
      res.status(422).json({ error: "Choose lesson dates before publishing." });
      return null;
    }
    const oldDescription = publishedSnapshotFor(program);
    const changedDescription =
      !oldDescription ||
      Object.entries(description.value).some(
        ([key, value]) =>
          oldDescription[key as keyof typeof oldDescription] !== value,
      );
    if (changedDescription) {
      const [sibling] = await tx
        .select({ id: learningProgramBatchesTable.id })
        .from(learningProgramBatchesTable)
        .where(
          and(
            eq(learningProgramBatchesTable.programId, program.id),
            eq(learningProgramBatchesTable.status, "published"),
            ne(learningProgramBatchesTable.id, batch.id),
          ),
        )
        .limit(1);
      if (sibling) {
        res
          .status(409)
          .json({
            error:
              "Another set of dates for this class is already published. Keep the shared description unchanged so those students do not lose their listing. You can still change this timetable and price.",
          });
        return null;
      }
    }
    const version = changedDescription ? program.version + 1 : program.version;
    const linked = await periodFor(batch.id, tx);
    const period = linked
      ? tuitionPeriod(
          linked.group.id,
          linked.link.periodIndex,
          linked.group.anchorAt ?? lessons[0]!.startsAt,
        )
      : undefined;
    const problems = period ? tuitionPeriodIssues(period, lessons) : [];
    if (problems.length) {
      res
        .status(422)
        .json({ error: "Check the lesson dates.", issues: problems });
      return null;
    }
    if (
      !Number.isInteger(batch.capacity) ||
      !Number.isInteger(batch.totalTuitionNpr) ||
      batch.capacity! < 1 ||
      batch.capacity! > 10 ||
      batch.totalTuitionNpr! < 1
    ) {
      res.status(422).json({ error: "Check the class size and full price." });
      return null;
    }
    const [joining] = await tx.select().from(teachingClassJoiningTable).where(eq(teachingClassJoiningTable.batchId, batch.id));
    const snapshot = batchSnapshot({
      allowLateJoining: !!period && joining?.allowLateJoining === true,
      batchId: batch.id,
      version: batch.version + 1,
      programId: program.id,
      programVersion: version,
      programTitle: description.value.title,
      capacity: batch.capacity!,
      totalTuitionNpr: batch.totalTuitionNpr!,
      lessons,
      tuitionPeriod: period,
    });
    if (!readBatchSnapshot(snapshot)) {
      res
        .status(422)
        .json({
          error:
            "Check every lesson date, duration and the full price before publishing.",
        });
      return null;
    }
    if (
      !changedDescription &&
      program.status === "published" &&
      batch.status === "published" &&
      sameBatchOffer(readBatchSnapshot(batch.publishedSnapshot), snapshot)
    )
      return {
        item: await view((await owned(batch.id, teacherId, tx))!, tx),
        unchanged: true,
      };
    if (
      Date.parse(snapshot.enrollmentClosesAt) <= Date.now() ||
      lessons.some((lesson) => lesson.startsAt.getTime() <= Date.now())
    ) {
      res
        .status(422)
        .json({
          error:
            "Choose future dates. A teaching period that has started cannot be republished.",
        });
      return null;
    }
    await assertTeacherSchedule(
      tx,
      teacherId,
      lessons.map((l) => ({ ...l, label: `Lesson ${l.position + 1}` })),
      { batchId: batch.id },
    );
    if (linked && !linked.group.anchorAt)
      await tx
        .update(learningProgramTuitionGroupsTable)
        .set({ anchorAt: lessons[0]!.startsAt })
        .where(eq(learningProgramTuitionGroupsTable.id, linked.group.id));
    await tx
      .update(learningProgramsTable)
      .set({
        status: "published",
        version,
        publishedAt: program.publishedAt ?? new Date(),
        publishedSnapshot: simpleClassSnapshot(description.value, version),
      })
      .where(eq(learningProgramsTable.id, program.id));
    await tx
      .update(learningProgramBatchesTable)
      .set({
        status: "published",
        version: snapshot.version,
        publishedAt: new Date(),
        publishedSnapshot: snapshot,
      })
      .where(eq(learningProgramBatchesTable.id, batch.id));
    return {
      item: await view((await owned(batch.id, teacherId, tx))!, tx),
      unchanged: false,
    };
  });
  if (!result) return;
  if (!result.unchanged)
    activity(teacherId, row.batch.id, "teaching_class.published");
  res.json(result);
});
export default router;
