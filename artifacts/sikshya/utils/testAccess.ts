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
