/**
 * Is this class a day of somebody's Monthly plan, and was that day paid for?
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
 * ## Judged at the class's own time, not at "now"
 *
 * The correction that matters. An earlier version asked "is the plan active *right now*", which
 * is too blunt in the direction that takes things away from people: a teacher who turns off
 * renewal on the 20th has still paid for the cycle running to the 30th, and every class inside
 * it. Entitlement is therefore evaluated against the **session's own scheduled time** — the
 * cycle that class falls in — rather than the moment somebody happens to ask.
 *
 * That also settles rescheduling by construction. Move a class across a cycle boundary and it is
 * simply in a different cycle, judged on that one's coverage. There is no separate rule for it
 * and so no second rule to drift.
 *
 * ## What this can prove, and what it cannot — read before extending
 *
 * The brief asked for a rule that distinguishes *cancelled but still paid through the cycle*
 * from *expired*, and honours *payment reversal* and *explicit revocation*. *Three of those four
 * cannot be derived from this schema*, and inventing them would mean inventing payment facts.
 * Precisely what is missing, so nobody has to re-derive it:
 *
 * 1. **No payment record of any kind.** `chargeForMonthly` returns a reference string and
 *    **nothing stores it**. There is no ledger table, no `payments` table, no row saying which
 *    cycle was paid for or when. `teacher_plans.price` records what was charged once, at
 *    purchase, and never again.
 * 2. **No renewal concept.** A plan is bought once and its cycles roll forward by arithmetic
 *    from `cycle_anchor`. There is no per-cycle charge, so there is no `cancel_at_period_end`,
 *    no `current_period_end`, and no `paid_through`. "Renewal turned off" is not a state this
 *    system can currently be in.
 * 3. **No teacher-subscription reversal.** The `refunds` table is about *students* — it carries
 *    `student_id`, `recurring_id`, `cycle_index`. Nothing records a teacher's subscription being
 *    refunded or charged back.
 * 4. **No explicit entitlement revocation.** `status` is one blunt field — `active`, `lapsed`,
 *    `suspended` — with no `lapsed_at`, so even the moment a plan stopped being active is
 *    unknown. Using `updated_at` as a proxy would be inventing a payment fact.
 *
 * **So this stops where the brief says to stop.** It implements the half that *is* derivable —
 * judging coverage at the session's own time — and treats operator suspension as revoking,
 * because that one is recorded and dated. `lapsed` still denies, and the honest reason is that
 * this schema cannot tell a teacher who cancelled inside a paid cycle from one who never paid.
 * Fixing that is a schema change and a commercial decision, and both belong with the owner.
 */
import { eq } from "drizzle-orm";
import { db, recurringDaysTable, recurringSessionsTable, sessionsTable, teacherPlansTable } from "@workspace/db";
import { cycleAt } from "../monthly.ts";

export type IneligibleReason =
  | "recurring-day-missing"
  | "class-missing"
  | "plan-missing"
  | "cycle-not-started"
  | "plan-suspended"
  | "plan-lapsed"
  | "before-coverage";

export interface MonthlyClassification {
  /** True only when the whole chain holds and the class falls inside covered time. */
  monthly: boolean;
  /** Why not. For the log and the operator narrative; never shown as a raw code to a user. */
  reason: IneligibleReason | null;
  /** The recurring class this day belongs to, when it has one. */
  recurringId: number | null;
  /** Which cycle the class's own scheduled time falls in, counted from the plan's anchor. */
  cycleIndex: number | null;
}

const no = (reason: IneligibleReason, recurringId: number | null = null, cycleIndex: number | null = null):
  MonthlyClassification => ({ monthly: false, reason, recurringId, cycleIndex });

/**
 * The one place this question is answered.
 *
 * Returns a reason as well as a boolean because an operator reading a session's record needs to
 * know whether a discussion was absent because the class was pay-as-you-go, because the teacher
 * was suspended, or because the plan had lapsed — those look identical from the outside and mean
 * different things in a refund argument.
 */
export async function classifyMonthly(sessionId: number): Promise<MonthlyClassification> {
  const [day] = await db
    .select({ recurringId: recurringDaysTable.recurringId, scheduledFor: recurringDaysTable.scheduledFor })
    .from(recurringDaysTable)
    .where(eq(recurringDaysTable.sessionId, sessionId))
    .limit(1);

  if (!day) return no("recurring-day-missing");

  const [cls] = await db
    .select({ planId: recurringSessionsTable.planId })
    .from(recurringSessionsTable)
    .where(eq(recurringSessionsTable.id, day.recurringId))
    .limit(1);

  if (!cls) return no("class-missing", day.recurringId);

  const [plan] = await db
    .select({
      status: teacherPlansTable.status,
      cycleAnchor: teacherPlansTable.cycleAnchor,
    })
    .from(teacherPlansTable)
    .where(eq(teacherPlansTable.id, cls.planId))
    .limit(1);

  if (!plan) return no("plan-missing", day.recurringId);
  if (plan.cycleAnchor === null) return no("cycle-not-started", day.recurringId);

  /*
    The class's own time, preferred over the class-day's planned time.

    A rescheduled class has a new `sessions.date`; the `recurring_days.scheduled_for` it was
    generated from does not move. Judging coverage on the stale one would give the wrong answer
    for exactly the case the brief names — a class moved across a cycle boundary.
  */
  const [session] = await db
    .select({ date: sessionsTable.date })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);

  const when = session?.date ?? day.scheduledFor;
  const cycle = cycleAt(plan.cycleAnchor, when);
  const cycleIndex = cycle?.index ?? null;

  /*
    Before the plan began.

    `cycleAt` folds anything earlier than the anchor into cycle 0 — reasonable for its own
    callers, and wrong here, because a class scheduled before the teacher ever bought a plan is
    not covered by it. Checked explicitly rather than relying on the index.
  */
  const scheduledMs = when instanceof Date ? when.getTime() : new Date(when).getTime();
  const anchorMs = plan.cycleAnchor.getTime();
  if (Number.isFinite(scheduledMs) && scheduledMs < anchorMs) {
    return no("before-coverage", day.recurringId, cycleIndex);
  }

  /*
    Operator suspension revokes, and it is the one revocation this schema can actually evidence:
    a dated decision by a person, recorded with a reason.

    Note what this does *not* do: treat an expired `suspended_until` as ending the suspension.
    That would be inventing a rule the rest of the system does not have — **nothing anywhere
    reads `suspended_until` to decide a suspension has lapsed, and nothing ever sets `status`
    back to `active`.** A plan suspended for thirty days stays `suspended` until an operator
    changes it. Reading the date here would make this file the only place in the codebase that
    believes a suspension expires on its own, and a teacher would find their discussion quietly
    back while every other screen still called them suspended.
  */
  if (plan.status === "suspended") return no("plan-suspended", day.recurringId, cycleIndex);

  /*
    And here is the honest stopping point.

    A lapsed plan denies. That is right when the teacher stopped paying and wrong when they
    cancelled inside a cycle they had already paid for — and **this schema cannot tell those
    apart**, because nothing records which cycles were paid or when the plan lapsed. Denying is
    the direction that cannot give away unpaid product; it is not the direction that is fair to
    a teacher who paid. See the four missing facts at the top of this file.
  */
  if (plan.status !== "active") return no("plan-lapsed", day.recurringId, cycleIndex);

  return { monthly: true, reason: null, recurringId: day.recurringId, cycleIndex };
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
