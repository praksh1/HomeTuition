import { and, eq, or } from "drizzle-orm";
import {
  classGroupHomeworkFilesTable,
  classGroupHomeworkSubmissionsTable,
  classGroupHomeworkTable,
  db,
  homeworkSubmissionsTable,
  homeworkTable,
  recurringEnrollmentsTable,
  recurringSessionsTable,
} from "@workspace/db";
import { classGroupAccess } from "./classGroupAccess";

/**
 * May this person open this homework file?
 *
 * `GET /storage/file` allows the uploader, an agent, and the subject of a dispute, and its own
 * comment says any further use must be checked explicitly rather than guessed at. This is that
 * check for homework, and there are exactly three ways in:
 *
 * - **The question sheet**, which the teacher uploaded and every student in the class must be
 *   able to open, or the homework cannot be done.
 * - **A student's answer**, which only that student and their teacher may open. Not the rest of
 *   the class: forty-five people being able to read each other's work is not a portal, it is a
 *   leak.
 * - **The marked-up copy** the teacher hands back, on the same terms as the answer it marks.
 *
 * Everything is matched against a real row. A key that belongs to no homework is refused here
 * and falls through to the caller's own refusal.
 */
export async function mayOpenHomeworkFile(key: string, userId: number): Promise<boolean> {
  // New-style class homework: everyone booked into the class may read the question sheet;
  // only the submitting student and that class's teacher may read an answer or marked copy.
  const [classFile] = await db
    .select({
      batchId: classGroupHomeworkTable.batchId,
      kind: classGroupHomeworkFilesTable.kind,
      studentId: classGroupHomeworkSubmissionsTable.studentId,
    })
    .from(classGroupHomeworkFilesTable)
    .innerJoin(
      classGroupHomeworkTable,
      eq(classGroupHomeworkTable.id, classGroupHomeworkFilesTable.homeworkId),
    )
    .leftJoin(
      classGroupHomeworkSubmissionsTable,
      eq(
        classGroupHomeworkSubmissionsTable.id,
        classGroupHomeworkFilesTable.submissionId,
      ),
    )
    .where(eq(classGroupHomeworkFilesTable.fileKey, key))
    .limit(1);
  if (classFile) {
    const access = await classGroupAccess(classFile.batchId, userId);
    if (!access) return false;
    if (classFile.kind === "question") return true;
    return access.isTeacher || classFile.studentId === userId;
  }

  // The question sheet: this class's teacher, or anybody who has ever held a place in it.
  const [sheet] = await db
    .select({ teacherId: homeworkTable.teacherId, recurringId: homeworkTable.recurringId })
    .from(homeworkTable)
    .where(eq(homeworkTable.fileKey, key))
    .limit(1);

  if (sheet) {
    if (sheet.teacherId === userId) return true;
    const [place] = await db
      .select({ id: recurringEnrollmentsTable.id })
      .from(recurringEnrollmentsTable)
      .where(
        and(
          eq(recurringEnrollmentsTable.recurringId, sheet.recurringId),
          eq(recurringEnrollmentsTable.studentId, userId),
        ),
      )
      .limit(1);
    return Boolean(place);
  }

  // An answer, or the marked-up copy of one: that student and that class's teacher, nobody else.
  const [submission] = await db
    .select({
      studentId: homeworkSubmissionsTable.studentId,
      teacherId: recurringSessionsTable.teacherId,
    })
    .from(homeworkSubmissionsTable)
    .innerJoin(homeworkTable, eq(homeworkTable.id, homeworkSubmissionsTable.homeworkId))
    .innerJoin(recurringSessionsTable, eq(recurringSessionsTable.id, homeworkTable.recurringId))
    .where(
      or(
        eq(homeworkSubmissionsTable.fileKey, key),
        eq(homeworkSubmissionsTable.annotatedKey, key),
      ),
    )
    .limit(1);

  if (!submission) return false;
  return submission.studentId === userId || submission.teacherId === userId;
}
