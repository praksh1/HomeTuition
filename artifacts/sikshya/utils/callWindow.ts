/**
 * The size of the call window, in words no provider owns.
 *
 * Sikshya has always owned this window — the classroom drags it, hides it, snaps it between two
 * docked sizes and blows it up to the whole screen — and the provider inside it has never been
 * told. That was fine when the provider was an iframe that could not have used the information.
 *
 * It stops being fine the moment a provider can act on it. A call nobody can see should not be
 * carrying anybody's camera: on a phone that is battery and heat, on a Nepali mobile connection
 * it is bandwidth the whiteboard needs, and on a provider that bills by received resolution it
 * is money. So the window says how big it is, in four neutral words, and a provider that can do
 * something about it does.
 *
 * The names are deliberately not the classroom's own (`small`, `medium`). Those describe two
 * docked sizes that only that screen knows about; these describe how much of a picture is worth
 * sending, which is the question a provider can actually answer.
 */
export type CallWindowState = "hidden" | "compact" | "normal" | "full";

/** What the two classroom screens call their window sizes. */
export type ClassroomVideoSize = "hidden" | "small" | "medium" | "full";

/**
 * Translate one to the other.
 *
 * One function rather than a mapping written out in each classroom, for the same reason the call
 * clock is one file: two screens with the same rule written twice is two screens with the rule
 * written differently, eventually.
 */
export function neutralVideoWindowState(size: ClassroomVideoSize): CallWindowState {
  switch (size) {
    case "hidden":
      return "hidden";
    case "small":
      return "compact";
    case "medium":
      return "normal";
    case "full":
      return "full";
  }
}
