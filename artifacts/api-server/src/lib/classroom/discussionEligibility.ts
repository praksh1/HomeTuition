/**
 * Is this class a day of somebody's Monthly plan?
 *
 * ## Derived, never declared
 *
 * There is no `isMonthly` column and this deliberately does not add one. A monthly class is an
 * ordinary `sessions` row — that is the design, recorded on `recurring_days`: *"Each row points
 * at a real sessions row, so a monthly class is the same object as any other class once it
 * starts."* What makes it monthly is that a `recurring_days` row points at it, and that row
 * belongs to a recurring class, which belongs to a teacher's plan.
 *
 * So eligibility is a join, not a flag. A flag could be set once and be wrong forever after a
 * plan lapsed; the join is right by construction every time it is asked.
 *
 * `monthlyStore.isRecurringDay` already asks half of this question — it is what stops anybody
 * booking a seat in a paid course for nothing. This asks the other half: not merely *is it a
 * recurring day*, but *is the plan behind it a live entitlement*.
 *
 * ## What "valid" means, and what is deliberately left open
 *
 * A plan is valid here when it is `active` and its cycle has started. `lapsed` and `suspended`
 * are not: a teacher serving a suspension should not be handing out extra features, and a
 * lapsed plan is one nobody is paying for.
 *
 * **What happens to a class already on the calendar when a plan lapses mid-cycle is a
 * commercial question, not a technical one.** This file answers it the conservative way — the
 * discussion disappears with the entitlement — because that is the only answer that cannot
 * give away something unpaid for. If the owner wants a grace period, that is a rule about money
 * and belongs with the others in `lib/monthly.ts`, decided rather than inferred here. Recorded
 * in the backlog rather than invented.
 */
import { and, eq } from "drizzle-orm";
import { db, recurringDaysTable, recurringSessionsTable, teacherPlansTable } from "@workspace/db";

export interface MonthlyClassification {
  /** True only when the whole chain holds: class-day → recurring class → live plan. */
  monthly: boolean;
  /** Why not, for the log and the operator narrative. Never shown as a raw code to a user. */
  reason: "recurring-day-missing" | "class-missing" | "plan-missing" | "plan-not-active" | "cycle-not-started" | null;
  /** The recurring class this day belongs to, when it has one. */
  recurringId: number | null;
}

/**
 * The one place this question is answered.
 *
 * Returns a reason as well as a boolean because an operator reading a session's record needs to
 * know whether a discussion was absent because the class was pay-as-you-go or because the
 * teacher's plan had lapsed — those look identical from the outside and mean opposite things in
 * a refund argument.
 */
export async function classifyMonthly(sessionId: number): Promise<MonthlyClassification> {
  const [day] = await db
    .select({ recurringId: recurringDaysTable.recurringId })
    .from(recurringDaysTable)
    .where(eq(recurringDaysTable.sessionId, sessionId))
    .limit(1);

  if (!day) return { monthly: false, reason: "recurring-day-missing", recurringId: null };

  const [cls] = await db
    .select({ planId: recurringSessionsTable.planId })
    .from(recurringSessionsTable)
    .where(eq(recurringSessionsTable.id, day.recurringId))
    .limit(1);

  if (!cls) return { monthly: false, reason: "class-missing", recurringId: day.recurringId };

  const [plan] = await db
    .select({ status: teacherPlansTable.status, cycleAnchor: teacherPlansTable.cycleAnchor })
    .from(teacherPlansTable)
    .where(eq(teacherPlansTable.id, cls.planId))
    .limit(1);

  if (!plan) return { monthly: false, reason: "plan-missing", recurringId: day.recurringId };
  if (plan.status !== "active") {
    return { monthly: false, reason: "plan-not-active", recurringId: day.recurringId };
  }
  /*
    A plan bought but never started has a null anchor — the teacher paid and has not created
    their recurring class yet. It cannot have class-days, so reaching here means something is
    inconsistent; refusing is the safe direction.
  */
  if (plan.cycleAnchor === null) {
    return { monthly: false, reason: "cycle-not-started", recurringId: day.recurringId };
  }

  return { monthly: true, reason: null, recurringId: day.recurringId };
}

/**
 * The boolean the room route hands to the app.
 *
 * Named for what it grants rather than for what it is derived from, so a future second Monthly
 * benefit can hang off the same answer without the field having to be renamed. Defaults closed:
 * every path that cannot prove the entitlement returns false.
 */
export async function discussionModeEligible(sessionId: number): Promise<boolean> {
  try {
    return (await classifyMonthly(sessionId)).monthly;
  } catch {
    /*
      A failed lookup is not permission granted.

      The same instinct as `requirePasswordChanged` in the admin router, which answers 503 rather
      than falling through: a database that cannot answer "is this paid for?" must not be read as
      "yes".
    */
    return false;
  }
}
