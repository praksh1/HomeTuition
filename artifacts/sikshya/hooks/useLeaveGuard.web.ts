import { useEffect } from "react";

/**
 * The browser's own ways of leaving, which the app cannot draw a confirmation sheet over.
 *
 * Reload, closing the tab, typing a different address, the operating system's Back gesture — none
 * of these go through React Navigation, so the studio's own guard never sees them. `beforeunload`
 * is the only hook a page gets, and what it produces is the browser's built-in wording, not ours:
 * Chrome and Safari long ago stopped letting a page choose the sentence, because the feature was
 * used to trap people. That is a fair trade for the alternative, which is a teacher pressing
 * refresh on a slow connection and losing what they typed with no question asked at all.
 *
 * `active` is `wouldLoseWork(saveState)` and nothing else, so the dialog appears exactly when a
 * save is unsaved, in flight or failed — never on a clean screen, where an unexpected "leave site?"
 * would teach a teacher to click through it without reading.
 */
export function useBrowserLeaveGuard(active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const ask = (event: BeforeUnloadEvent) => {
      /*
        Both, deliberately. `preventDefault` is the standard; `returnValue` is what older WebKit and
        several Android browsers still read, and this app is aimed at exactly those. Setting one
        without the other works on a developer's Chrome and silently does nothing on a cheap phone.
      */
      event.preventDefault();
      event.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [active]);
}
