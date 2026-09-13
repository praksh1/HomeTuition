import { eq } from "drizzle-orm";
import {
  classGroupMaterialFilesTable,
  classGroupMaterialsTable,
  db,
} from "@workspace/db";
import { classGroupAccess } from "./classGroupAccess";

/**
 * A class handout belongs to the teacher and every student booked into that class.
 *
 * Materials are intentionally different from ordinary chat history: a student who joins late
 * still needs the syllabus, worksheet or reference sheet required for the lessons ahead. The
 * batch's existing authority remains the only membership decision.
 */
export async function mayOpenClassMaterialFile(
  key: string,
  userId: number,
): Promise<boolean> {
  const [file] = await db
    .select({ batchId: classGroupMaterialsTable.batchId })
    .from(classGroupMaterialFilesTable)
    .innerJoin(
      classGroupMaterialsTable,
      eq(classGroupMaterialsTable.id, classGroupMaterialFilesTable.materialId),
    )
    .where(eq(classGroupMaterialFilesTable.fileKey, key))
    .limit(1);
  if (!file) return false;
  return Boolean(await classGroupAccess(file.batchId, userId));
}
