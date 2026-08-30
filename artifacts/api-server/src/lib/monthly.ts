/**
 * The monthly tier: cycles, what a student owes, and whether a teacher delivered.
 *
 * Pure — arithmetic and clock comparisons only, no database — for the same reason
 * sessionChanges.ts is pure: these decide what people are charged and what they get back, and a
 * rule about money that can only be exercised against a live database is a rule nobody tests.
 *
 * ### One cycle, and it is not a month
 *
 * A cycle is **thirty times twenty-four hours from a timestamp**. It is not a calendar month in
 * either calendar, and that is deliberate. A Bikram Sambat month runs 29 to 32 days and a
 * Gregorian one 28 to 31; if any rate were computed from "a month", the two calendars would
 * disagree about somebody's money. Bikram Sambat and Gregorian are display only, everywhere.
 *
 * The owner asked for this to be clean. This is what clean means here: **no calendar arithmetic
 * ever touches a price.**
 *
 * ### The teacher's cycle is the only cycle
 *
 * A student who joins part-way through pays for what is left of *the teacher's* cycle and then
 * renews on the same day the teacher does. Aligning to calendar months instead would leave the
 * two permanently out of step — a teacher whose cycle began on the 12th renewing on the 12th
 * while their students renewed on the 1st, which is exactly the situation the owner asked to
 * avoid: the teacher takes leave in a fresh cycle while students are mid-way through one they
 * have already paid for.
 *
 * ### Priced in sessions, not days
 *
 * What is sold is classes. The quality floor is stated in sessions — twenty-five a cycle — so
 * pricing in days would mean two units and an argument in the gap between them: a student who
 * joins for nine days that happen to contain six classes would be charged for nine.
 */

/** The billing period, in days. Not a month in any calendar. */
export const CYCLE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What a teacher pays Sikshya each cycle for the tier. */
export const TEACHER_TIER_PRICE = 6500;

/**
 * Sikshya's cut of what students pay, as a fraction.
 *
 * Set by the owner at 30% and explicitly changeable. It lives here as one number so a decision
 * to change it is one edit rather than a search, and so the split can never disagree with
 * itself between the quote a student is shown and the ledger row that follows.
 */
export const PLATFORM_SHARE = 0.3;

/** The fewest classes a teacher may deliver in a cycle before students are owed money back. */
export const MIN_SESSIONS_PER_CYCLE = 25;
/** Make-up classes allowed per cycle. */
export const MAX_MAKEUPS_PER_CYCLE = 5;
/** The ceiling on classes in a cycle, make-ups included. */
export const MAX_SESSIONS_PER_CYCLE = 40;
/** How many students may hold a place. */
export const MAX_STUDENTS = 45;
/** The longest a daily class may run. */
export const MAX_DAILY_MINUTES = 90;
/** How long before the next class the daily time may still be moved. */
export const TIME_CHANGE_NOTICE_HOURS = 18;
/** How long a teacher has to put a make-up on the calendar before a miss counts against them. */
export const MAKEUP_DEADLINE_HOURS = 48;
/** Misses with no make-up before the teacher is suspended. */
export const MAX_ABUSES_PER_CYCLE = 5;
/** How long a suspension lasts, in days. */
export const SUSPENSION_DAYS = 30;
/**
 * How long a paid-for plan may sit without a class being created before its cycle starts anyway.
 *
 * The teacher is charged the day they buy, but the cycle is meant to start when they create
 * their recurring class. Without this a plan could be paid for and never started, and the money
 * would buy nothing at all. Seven days is long enough to set up a class and short enough that
 * nobody loses a month.
 */
export const PLAN_AUTOSTART_DAYS = 7;
/** How long a student keeps their place after a renewal goes unpaid. */
export const RENEWAL_GRACE_DAYS = 3;

export type Allowed = { ok: true } | { ok: false; reason: string };

function ms(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const at = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(at) ? at : null;
}

export interface Cycle {
  /** Which cycle since the anchor. 0 is the first. */
  index: number;
  start: number;
  end: number;
}

/**
 * Which cycle a moment falls in, counted from the anchor.
 *
 * Whole cycles from a fixed instant, so a teacher and their students are always in the same one
 * — there is nothing to drift. A moment before the anchor is treated as the first cycle: a
 * teacher's plan is not retroactive, and answering "cycle minus one" would only make callers
 * handle a case that cannot happen.
 */
export function cycleAt(anchor: Date | string | number, at: Date | string | number = Date.now()): Cycle | null {
  const from = ms(anchor);
  const now = ms(at);
  if (from === null || now === null) return null;

  const elapsed = now - from;
  const index = elapsed <= 0 ? 0 : Math.floor(elapsed / (CYCLE_DAYS * DAY_MS));
  const start = from + index * CYCLE_DAYS * DAY_MS;
  return { index, start, end: start + CYCLE_DAYS * DAY_MS };
}

/** When a cycle that started at this instant runs out. */
export function cycleEnd(start: Date | string | number): number | null {
  const from = ms(start);
  return from === null ? null : from + CYCLE_DAYS * DAY_MS;
}

/**
 * Whether a teacher-chosen make-up belongs to the cycle it is repairing.
 *
 * A make-up may use any time inside the cycle. The window is half-open for the same reason as
 * every other cycle rule: an instant exactly at the end belongs to the next cycle and must not
 * be counted once in each.
 */
export function makeupFallsWithinCycle(
  at: Date | string | number,
  cycleStart: Date | string | number,
  cycleEndsAt: Date | string | number,
): boolean {
  const chosen = ms(at);
  const start = ms(cycleStart);
  const end = ms(cycleEndsAt);
  return chosen !== null && start !== null && end !== null && chosen >= start && chosen < end;
}

/**
 * When a plan's cycle actually begins.
 *
 * The day the recurring class is created, or seven days after purchase if it never is — see
 * PLAN_AUTOSTART_DAYS. Returns null while a plan is still inside its grace and has no class,
 * which is the one state where a teacher has paid and no cycle is running.
 */
export function planCycleAnchor(
  purchasedAt: Date | string | number,
  firstSessionCreatedAt: Date | string | number | null,
  now: Date | string | number = Date.now(),
): number | null {
  const created = ms(firstSessionCreatedAt);
  if (created !== null) return created;

  const bought = ms(purchasedAt);
  if (bought === null) return null;

  const deadline = bought + PLAN_AUTOSTART_DAYS * DAY_MS;
  const at = ms(now) ?? Date.now();
  return at >= deadline ? deadline : null;
}

export interface JoinQuote {
  /** Classes left in the teacher's current cycle when this student joins. */
  sessionsRemaining: number;
  /** Classes the cycle was planned to hold. The denominator, locked at join. */
  sessionsPlanned: number;
  /** What the student pays now. */
  amount: number;
  /** Sikshya's cut of that. */
  platformShare: number;
  /** The teacher's cut, held until the cycle's delivery is known. */
  teacherShare: number;
  /**
   * True when there is nothing left to buy in this cycle, so the student starts at the next one
   * and pays nothing today. Joining an hour before the last class of a cycle and being charged
   * for it, then charged in full the next morning, is not a thing to do to somebody.
   */
  startsNextCycle: boolean;
}

/**
 * What a student owes to join part-way through a teacher's cycle.
 *
 * The fraction is classes remaining over classes planned, and the denominator is locked at the
 * moment of joining. It has to be: a teacher who later adds make-ups would otherwise
 * retroactively change what somebody already paid, and a bill that moves after the fact is a
 * bill nobody can check.
 *
 * Rounded **down**. A fraction of a rupee has to fall somewhere, and it should not fall on the
 * person being charged — the same principle as the refund split, which rounds the student's
 * money up. Never a rupee more taken than is owed.
 */
export function quoteJoin(
  monthlyPrice: number,
  sessionsRemaining: number,
  sessionsPlanned: number,
): JoinQuote {
  const price = Math.max(0, Math.round(monthlyPrice));
  const planned = Math.max(0, Math.round(sessionsPlanned));
  const remaining = Math.max(0, Math.min(Math.round(sessionsRemaining), planned));

  if (remaining === 0 || planned === 0) {
    return {
      sessionsRemaining: 0,
      sessionsPlanned: planned,
      amount: 0,
      platformShare: 0,
      teacherShare: 0,
      startsNextCycle: true,
    };
  }

  const amount = Math.floor((price * remaining) / planned);
  const platformShare = Math.round(amount * PLATFORM_SHARE);
  return {
    sessionsRemaining: remaining,
    sessionsPlanned: planned,
    amount,
    platformShare,
    // Derived from the remainder so the two always add back to what was charged.
    teacherShare: amount - platformShare,
    startsNextCycle: false,
  };
}

export interface DeliveryVerdict {
  /** Classes actually held this cycle. */
  held: number;
  /** Classes that should have been held and were not, with no make-up. */
  missed: number;
  /** True when the teacher met the floor. */
  met: boolean;
  /** How many short of the floor. Zero when met. */
  shortBy: number;
}

/** Whether a teacher delivered what a cycle promised. */
export function deliveryVerdict(held: number, missed: number): DeliveryVerdict {
  const delivered = Math.max(0, Math.round(held));
  const met = delivered >= MIN_SESSIONS_PER_CYCLE;
  return {
    held: delivered,
    missed: Math.max(0, Math.round(missed)),
    met,
    shortBy: met ? 0 : MIN_SESSIONS_PER_CYCLE - delivered,
  };
}

/**
 * The plain arithmetic of "paid for this many, got fewer".
 *
 * Rounded **up**, because this is money going to somebody rather than being taken from them —
 * the same direction as every other refund in this codebase. Capped at what they paid: a
 * student cannot be owed more than they handed over, whatever the arithmetic upstream has been
 * asked to believe.
 *
 * On its own this says nothing about whether a refund is *due*. Two different rules decide
 * that, and they disagree — see the two callers below.
 */
export function proRatedShortfall(amountPaid: number, sessionsPaidFor: number, sessionsReceived: number): number {
  const paid = Math.max(0, Math.round(amountPaid));
  const bought = Math.max(0, Math.round(sessionsPaidFor));
  const got = Math.max(0, Math.min(Math.round(sessionsReceived), bought));
  if (paid === 0 || bought === 0 || got >= bought) return 0;
  return Math.min(paid, Math.ceil((paid * (bought - got)) / bought));
}

/**
 * Did the teacher clear the delivery floor for a cycle?
 *
 * The owner's flat floor: twenty-five classes held, judged across the whole cycle, regardless
 * of who was enrolled for how much of it.
 */
export function metDeliveryFloor(cycleSessionsHeld: number): boolean {
  return Math.max(0, Math.round(cycleSessionsHeld)) >= MIN_SESSIONS_PER_CYCLE;
}

/**
 * Did *this student* get the share of classes the floor promises?
 *
 * The cycle floor on its own has a sharp edge: a student who joined late, bought nine classes
 * and lost three of them is owed nothing if the teacher still cleared twenty-five overall. The
 * teacher kept their promise to the month; they did not keep it to this student, who received
 * two thirds of what they paid for. The owner agreed that was too harsh.
 *
 * So the floor is also read as a **rate**. Twenty-five of thirty is a promise to hold five
 * sixths of the classes, and a student is owed when the classes they actually received fall
 * below five sixths of the classes they bought.
 *
 * Compared by cross-multiplying rather than by working out a share and rounding it. A share of
 * nine classes is seven and a half, and rounding that either way quietly changes who gets paid;
 * the comparison below has no rounding in it at all, and for a student who bought the whole
 * month it reduces to exactly "twenty-five of thirty" — the owner's rule, unchanged, for the
 * case it was written about.
 */
export function metStudentShare(
  sessionsReceived: number,
  sessionsPaidFor: number,
  cycleSessionsPlanned: number,
): boolean {
  const got = Math.max(0, Math.round(sessionsReceived));
  const bought = Math.max(0, Math.round(sessionsPaidFor));
  const planned = Math.max(0, Math.round(cycleSessionsPlanned));
  // A month with no classes planned promises nothing, so nothing can fall short of it.
  if (bought === 0 || planned === 0) return true;
  return got * planned >= MIN_SESSIONS_PER_CYCLE * bought;
}

/** One student's claim at the end of a cycle. */
export interface RefundClaim {
  /** What this student handed over for the cycle. */
  amountPaid: number;
  /** Classes this student bought — the numerator they were charged on. */
  sessionsPaidFor: number;
  /** Classes this student actually received. */
  sessionsReceived: number;
  /** Classes the teacher held across the whole cycle, whoever was enrolled. */
  cycleSessionsHeld: number;
  /** Classes the cycle set out to hold. Counted, never assumed to be thirty. */
  cycleSessionsPlanned: number;
}

/**
 * What one student is owed at the end of a cycle.
 *
 * Two ways to be owed, and either is enough:
 *
 * 1. **The teacher missed the floor.** Fewer than twenty-five classes held in the month — the
 *    owner's rule, in their words. A teacher who held twenty-nine of thirty owes nothing; the
 *    floor is the promise, not the plan. Below it the *whole* shortfall comes back rather than
 *    only the part beneath twenty-five, because missing the floor voids the month's promise
 *    rather than discounting it.
 * 2. **This student got less than their share of it.** See `metStudentShare`. Added after the
 *    owner agreed rule 1 alone was too harsh on somebody who joined late and then lost most of
 *    what they had bought.
 *
 * Either, rather than replacing the first with the second, deliberately. The second protects a
 * late joiner the first misses, but the first also protects somebody the second would miss — a
 * student who received nearly all of their few classes from a teacher who badly under-delivered
 * the month. Taking either alone would leave one of them worse off than the rule already
 * agreed, and nobody should lose cover to a change meant to add it.
 *
 * A claim rather than five numbers in a row: every field here is a count, they are easy to
 * transpose, and transposing two of them silently changes what somebody is paid.
 */
export function shortfallRefund(claim: RefundClaim): number {
  const teacherKeptTheMonth = metDeliveryFloor(claim.cycleSessionsHeld);
  const studentGotTheirShare = metStudentShare(
    claim.sessionsReceived,
    claim.sessionsPaidFor,
    claim.cycleSessionsPlanned,
  );
  if (teacherKeptTheMonth && studentGotTheirShare) return 0;
  return proRatedShortfall(claim.amountPaid, claim.sessionsPaidFor, claim.sessionsReceived);
}

export interface Clawback {
  /** Back to the student. */
  refunded: number;
  /** Taken out of what the teacher had coming. */
  fromTeacher: number;
  /** Taken out of Sikshya's fee, once the teacher's share is exhausted. */
  fromPlatform: number;
  /** What the teacher still keeps. */
  teacherKeeps: number;
  /** What Sikshya still keeps. */
  platformKeeps: number;
}

/**
 * Where a monthly refund's money comes from.
 *
 * The owner was specific: it comes out of the teacher's share, which Sikshya is holding, and
 * then out of Sikshya's own fee. In that order — the teacher did not deliver, so the teacher
 * carries it first, and Sikshya carries the rest rather than the student carrying any of it.
 *
 * That ordering only means anything because the money is **held**. A student's fee is not paid
 * out at the moment they join; it sits until the month has been delivered, which is what makes
 * a refund possible at all. If it were paid straight through, there would be nothing to take
 * back and this would be a bill to send a teacher rather than a refund to make.
 *
 * The four numbers always add back: what goes to the student plus what each side keeps is
 * exactly what the student paid.
 */
export function refundClawback(
  amountRefunded: number,
  teacherShareHeld: number,
  platformShareHeld: number,
): Clawback {
  const teacherHeld = Math.max(0, Math.round(teacherShareHeld));
  const platformHeld = Math.max(0, Math.round(platformShareHeld));
  const refunded = Math.min(Math.max(0, Math.round(amountRefunded)), teacherHeld + platformHeld);

  const fromTeacher = Math.min(refunded, teacherHeld);
  const fromPlatform = refunded - fromTeacher;

  return {
    refunded,
    fromTeacher,
    fromPlatform,
    teacherKeeps: teacherHeld - fromTeacher,
    platformKeeps: platformHeld - fromPlatform,
  };
}

/**
 * Whether a missed class has become a mark against the teacher.
 *
 * A miss is not an abuse straight away — a make-up may still be coming, and the owner set the
 * window at forty-eight hours. Only silence past that deadline counts.
 */
export function isAbuse(
  missedAt: Date | string | number,
  makeupScheduledAt: Date | string | number | null,
  now: Date | string | number = Date.now(),
): boolean {
  if (ms(makeupScheduledAt) !== null) return false;
  const missed = ms(missedAt);
  const at = ms(now);
  if (missed === null || at === null) return false;
  return at > missed + MAKEUP_DEADLINE_HOURS * 60 * 60 * 1000;
}

export interface AbuseStanding {
  abuses: number;
  /** True once the teacher should be suspended. */
  suspended: boolean;
  /** How many more misses before suspension. Zero once suspended. */
  remaining: number;
  /** True while they are close enough that they must be warned in the strongest terms. */
  warn: boolean;
}

/**
 * Where a teacher stands against the five-strike limit.
 *
 * `warn` turns on before the last strike rather than at it. The owner asked for a strong
 * warning "if he hasn't scheduled any makeups" — a warning that arrives with the suspension is
 * not a warning, it is a notification.
 */
export function abuseStanding(abuses: number): AbuseStanding {
  const count = Math.max(0, Math.round(abuses));
  const suspended = count >= MAX_ABUSES_PER_CYCLE;
  return {
    abuses: count,
    suspended,
    remaining: suspended ? 0 : MAX_ABUSES_PER_CYCLE - count,
    warn: !suspended && count >= MAX_ABUSES_PER_CYCLE - 2,
  };
}

/** When a suspension imposed now would lift. */
export function suspensionEnds(from: Date | string | number = Date.now()): number | null {
  const at = ms(from);
  return at === null ? null : at + SUSPENSION_DAYS * DAY_MS;
}

/** May the teacher still move the daily time? */
export function canChangeTime(
  nextSessionAt: Date | string | number | null,
  now: Date | string | number = Date.now(),
): Allowed {
  const next = ms(nextSessionAt);
  const at = ms(now);
  if (next === null || at === null) return { ok: true };

  if (at > next - TIME_CHANGE_NOTICE_HOURS * 60 * 60 * 1000) {
    return {
      ok: false,
      reason:
        `The time can only be changed more than ${TIME_CHANGE_NOTICE_HOURS} hours before the ` +
        `next class, so your students are not caught out by it.`,
    };
  }
  return { ok: true };
}

/** May another make-up be added to this cycle? */
export function canAddMakeup(makeupsUsed: number, sessionsThisCycle: number): Allowed {
  if (makeupsUsed >= MAX_MAKEUPS_PER_CYCLE) {
    return {
      ok: false,
      reason: `You have used all ${MAX_MAKEUPS_PER_CYCLE} make-up classes for this month.`,
    };
  }
  if (sessionsThisCycle >= MAX_SESSIONS_PER_CYCLE) {
    return {
      ok: false,
      reason: `A month cannot hold more than ${MAX_SESSIONS_PER_CYCLE} classes.`,
    };
  }
  return { ok: true };
}

/** May another student take a place? */
export function canEnrol(studentsEnrolled: number): Allowed {
  if (studentsEnrolled >= MAX_STUDENTS) {
    return { ok: false, reason: `This class is full — it takes ${MAX_STUDENTS} students.` };
  }
  return { ok: true };
}

/** Is this a length a daily class may run for? */
export function isAllowedDuration(minutes: number): Allowed {
  if (!Number.isInteger(minutes) || minutes <= 0) {
    return { ok: false, reason: "The class length must be a whole number of minutes." };
  }
  if (minutes > MAX_DAILY_MINUTES) {
    return { ok: false, reason: `A daily class can run for at most ${MAX_DAILY_MINUTES} minutes.` };
  }
  return { ok: true };
}

/**
 * What a student is owed when their teacher stops — suspended, or the class withdrawn.
 *
 * Not the same as the delivery shortfall, which is judged at the end of a cycle. This is the
 * cycle ending early, so it is counted from classes that will now never happen. The owner was
 * explicit that a suspended teacher's students get "the full pro-rated refund for the remaining
 * period", and waiting until the cycle ends to work that out would leave somebody out of pocket
 * for up to a month over something that is already decided.
 */
export function stoppedEarlyRefund(
  amountPaid: number,
  sessionsPaidFor: number,
  sessionsAlreadyHeld: number,
): number {
  // Deliberately not gated on the delivery floor. A teacher suspended on day twenty-eight may
  // well have held more than twenty-five classes, and the owner was clear that their students
  // still get the remaining period back. The floor governs a cycle that ran and fell short; this
  // governs a cycle that stopped.
  return proRatedShortfall(amountPaid, sessionsPaidFor, sessionsAlreadyHeld);
}
