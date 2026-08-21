/**
 * Make the app as tall as the part of the screen you can actually see.
 *
 * Expo's web document sizes everything with `height: 100%`, which on iOS Safari resolves
 * against the **layout** viewport — and that is taller than the visible area whenever Safari's
 * bottom toolbar is showing. So the bottom of the app is drawn behind the browser's own
 * chrome. Reported from an iPhone during a call: "the chat window is under the browser's url
 * line when trying to enter message". A message box you cannot see is a message box you
 * cannot use.
 *
 * `dvh` is the unit that means "the viewport as it is right now", and it shrinks and grows as
 * the browser's bars collapse. Browsers that do not know it drop the declaration and keep the
 * `100%` already set by the document, so this can only improve matters.
 *
 * Injected at runtime rather than by replacing Expo's HTML template: overriding the template
 * means reproducing all of its defaults by hand and keeping them in step with the SDK, which
 * is a much larger thing to get wrong than a stylesheet.
 */

const STYLE_ID = "sikshya-viewport-fix";

export function applyWebViewportFix(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
@supports (height: 100dvh) {
  html, body, #root { height: 100dvh; }
}
/* A drag near the edge of a whiteboard should draw, not bounce the page or reload it. */
html, body { overscroll-behavior: none; }
`;
  document.head.appendChild(style);
}
