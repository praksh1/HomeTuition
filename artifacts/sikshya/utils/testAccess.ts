/**
 * What a test class is called, on the screens that show one.
 *
 * The server sends its own wording with the room (`testLabel`), and that is what gets painted —
 * this is the fallback for a build talking to a server too old to send it, and the single place
 * the sentence is written on this side. It mirrors `TEST_LABEL` in
 * `api-server/src/lib/testStudentAccess.ts`.
 *
 * The wording matters and is deliberate. "Test class" alone leaves somebody wondering whether they
 * were charged; the sentence answers that in the same breath.
 */
export const TEST_CLASS_LABEL = "TEST — no payment was processed";

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
 * `test` is a flag, never inferred from `amount === 0`. A genuinely free class and a class nobody
 * was charged for are different facts, and guessing gets both of them wrong.
 */
export function bookingNotice(booking: {
  topic: string;
  studentName?: string;
  amount?: number;
  test?: boolean;
}): { title: string; body: string } {
  const who = booking.studentName ?? "A student";
  if (booking.test) {
    return {
      title: `${who} joined your class — TEST`,
      body: `"${booking.topic}" — ${TEST_CLASS_LABEL}.`,
    };
  }
  return {
    title: `${who} booked your class`,
    body: booking.amount
      ? `NPR ${booking.amount.toLocaleString()} for "${booking.topic}".`
      : `"${booking.topic}" — tap to see who is coming.`,
  };
}
