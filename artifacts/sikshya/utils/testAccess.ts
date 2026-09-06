/**
 * **Two facts, two sentences, and they are not interchangeable.**
 *
 * Mirrors `TEST_CLASS_LABEL` and `TEST_BOOKING_LABEL` in
 * `api-server/src/lib/testStudentAccess.ts`. The server sends its own wording with every response;
 * these are the fallback for a build talking to an older server, and the single place either
 * sentence is written on this side.
 *
 * The distinction was learned the hard way. One flag and one label went to every viewer of a test
 * class, so an ordinary student — who pays full price for that same class, because a test class is
 * only *eligible* for test bookings — read "no payment was processed" **before being charged**,
 * and an ordinary paid student sat in the classroom under a banner saying their money had not been
 * taken.
 *
 * - **Class-level.** True of the class, for everyone, forever. Says what the class is open to and
 *   makes no claim about anybody's money.
 * - **Booking-level.** True of one person's own place. The only place a no-payment claim is honest.
 */
export const TEST_CLASS_LABEL = "TEST-ENABLED CLASS — only approved test bookings bypass payment";

/** One person's own enrolment took no money. Never shown to somebody who paid. */
export const TEST_BOOKING_LABEL = "TEST — no payment was processed";

/**
 * What a teacher is told when somebody takes a place in one of their classes.
 *
 * Pure and separate from `notifications.ts` because that file imports `expo-notifications` and
 * React Native, and wording about money has to be testable without either.
 *
 * The defect this exists to stop: a test booking took no money and the teacher's phone said
 * "Sita booked your class". Nothing in the old wording was a lie on its own — it simply left out
 * the only part that mattered, and a teacher reading it counts a sale that never happened.
 *
 * `testBooking` is a flag, never inferred from `amount === 0`. A genuinely free class and a class
 * nobody was charged for are different facts, and guessing gets both of them wrong.
 */
export function bookingNotice(booking: {
  topic: string;
  studentName?: string;
  amount?: number;
  /** *This booking* took no money. Not "the class is a test class" — see the labels above. */
  testBooking?: boolean;
}): { title: string; body: string } {
  const who = booking.studentName ?? "A student";
  if (booking.testBooking) {
    return {
      title: `${who} joined your class — TEST`,
      body: `"${booking.topic}" — ${TEST_BOOKING_LABEL}.`,
    };
  }
  return {
    title: `${who} booked your class`,
    body: booking.amount
      ? `NPR ${booking.amount.toLocaleString()} for "${booking.topic}".`
      : `"${booking.topic}" — tap to see who is coming.`,
  };
}
