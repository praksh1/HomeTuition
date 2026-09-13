import { and, eq } from "drizzle-orm";
import {
  batchTestBookingsTable,
  db,
  learningProgramBatchesTable,
  learningProgramsTable,
} from "@workspace/db";

export interface ClassGroupAccess {
  batchId: number;
  programId: number;
  teacherId: number;
  title: string;
  isTeacher: boolean;
  joinedAt: Date | null;
}

/** The one authority for new class-group learning tools. */
export async function classGroupAccess(
  batchId: number,
  userId: number,
): Promise<ClassGroupAccess | null> {
  const [group] = await db
    .select({
      batchId: learningProgramBatchesTable.id,
      programId: learningProgramsTable.id,
      teacherId: learningProgramsTable.teacherId,
      title: learningProgramsTable.title,
      publishedSnapshot: learningProgramsTable.publishedSnapshot,
    })
    .from(learningProgramBatchesTable)
    .innerJoin(
      learningProgramsTable,
      eq(learningProgramsTable.id, learningProgramBatchesTable.programId),
    )
    .where(eq(learningProgramBatchesTable.id, batchId))
    .limit(1);
  if (!group) return null;

  const snapshot = group.publishedSnapshot as { title?: unknown } | null;
  const title =
    typeof snapshot?.title === "string" && snapshot.title.trim()
      ? snapshot.title.trim()
      : group.title?.trim() || "Your class";
  if (group.teacherId === userId) {
    return { ...group, title, isTeacher: true, joinedAt: null };
  }

  const [booking] = await db
    .select({ createdAt: batchTestBookingsTable.createdAt })
    .from(batchTestBookingsTable)
    .where(
      and(
        eq(batchTestBookingsTable.batchId, batchId),
        eq(batchTestBookingsTable.studentId, userId),
      ),
    )
    .limit(1);
  if (!booking) return null;
  return { ...group, title, isTeacher: false, joinedAt: booking.createdAt };
}
