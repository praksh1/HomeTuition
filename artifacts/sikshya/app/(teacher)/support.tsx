/**
 * Customer Support, as a tab of its own.
 *
 * The owner asked for it directly: "the Customer Service needs to have a separate Tab!" —
 * for teachers and for students both. It was two taps down inside Profile, which is the wrong
 * place for the thing somebody reaches for when a class has just gone wrong.
 *
 * The screen itself is shared: `app/support.tsx` is also routable at /support, which is where
 * a class's own page sends a student whose teacher never turned up, carrying the class with
 * it. One screen, three ways in.
 */
export { default } from "../support";
