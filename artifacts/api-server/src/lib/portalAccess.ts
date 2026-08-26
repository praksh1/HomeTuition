import { and, eq } from "drizzle-orm";
import { db, recurringEnrollmentsTable, teacherPlansTable } from "@workspace/db";
import { classById, cycleOf } from "./monthlyStore";

/**
 * Who may see a monthly course, and who may write in it.
 *
 * ### Why this is in lib/ rather than beside the portal routes
 *
 * It answers "may this person be in this course?", which is the monthly tier's version of the
 * question `membership.ts` answers for a single class — and CLAUDE.md's first rule is that the
 * answer lives in one place. It moved here the moment a second caller needed it: opening a file
 * somebody sent in a class conversation (`lib/classMessageAccess.ts`) has to ask exactly this,
 * and a second copy of it is how the video route and the socket once came to disagree about
 * who was enrolled.
 */

export interface PortalAccess {
  klass: NonNullable<Awaited<ReturnType<typeof classById>>>;
  isTeacher: boolean;
  /** The month the course is in now. Null before it has started one. */
  cycleIndex: number | null;
  /** True while this student holds a place in the current month. */
  isCurrentStudent: boolean;
  /** True if they have ever held one, which is what read access hangs off. */
  wasEverStudent: boolean;
  /**
   * When this student first joined the course, and so how far back their thread starts.
   * Null for the teacher, who reads all of it.
   */
  joinedAt: Date | null;
}

/**
 * Who may see a monthly course's portal, and who may write in it.
 *
 * Reading and writing are separated for the same reason the class thread separates them: a
 * student whose month has ended, or who was refunded when a teacher was suspended, keeps what
 * was said and what they handed in. That record is most needed *after* they leave, because
 * that is when there is an argument about money.
 */
export async function portalAccess(classId: number, userId: number): Promise<PortalAccess | null> {
  const klass = await classById(classId);
  if (!klass) return null;

  const [plan] = await db.select().from(teacherPlansTable).where(eq(teacherPlansTable.id, klass.planId));
  const cycle = plan ? await cycleOf(plan) : null;
  const cycleIndex = cycle?.index ?? null;

  if (klass.teacherId === userId) {
    return { klass, isTeacher: true, cycleIndex, isCurrentStudent: false, wasEverStudent: false, joinedAt: null };
  }

  const places = await db
    .select({
      cycleIndex: recurringEnrollmentsTable.cycleIndex,
      status: recurringEnrollmentsTable.status,
      joinedAt: recurringEnrollmentsTable.joinedAt,
    })
    .from(recurringEnrollmentsTable)
    .where(
      and(
        eq(recurringEnrollmentsTable.recurringId, klass.id),
        eq(recurringEnrollmentsTable.studentId, userId),
      ),
    );
  if (places.length === 0) return null;

  /**
   * The first moment this student was ever in this course.
   *
   * Their *earliest* place, not the current one. Somebody who took the class in Bhadra, left,
   * and came back in Ashwin has already read that first month — cutting them back to their
   * newest enrolment would hide their own conversation from them.
   */
  const joinedAt = places
    .map((p) => p.joinedAt)
    .reduce<Date | null>((first, at) => (first === null || at < first ? at : first), null);

  return {
    klass,
    isTeacher: false,
    cycleIndex,
    isCurrentStudent: places.some((p) => p.cycleIndex === cycleIndex && p.status === "active"),
    wasEverStudent: true,
    joinedAt,
  };
}

/**
 * How far back this person may read.
 *
 * The owner's decision: *"hide any other prior messages for students who enrolled late"* — but
 * with pinned messages exempt, so a teacher can put the things that always matter where
 * everybody sees them whenever they arrived.
 *
 * A month of a class's conversation is other people's, and a student who joins on the 20th
 * walking into three weeks of it is being handed a room they were not in. The teacher sees all
 * of it: it is their class, and they wrote most of it.
 */
export const readableFrom = (access: PortalAccess): Date | null => (access.isTeacher ? null : access.joinedAt);

/** Reading is not writing: somebody whose month has ended may read, but not post. */
export const mayWrite = (access: PortalAccess) => access.isTeacher || access.isCurrentStudent;

