import { useEffect, useState } from "react";

export interface LeaveGuard {
  /** True while the screen holds work the server does not have. Arms the browser's own dialog. */
  dirty: boolean;
  /** True while a Back press should be caught and questioned. */
  armHistory: boolean;
  /**
   * True while the leave question is on screen.
   *
   * It stops a *new* sentinel being pushed, and nothing else. Without it the guard re-arms
   * underneath the teacher between the Back press and their answer, and the Back they then agree to
   * spends itself undoing the guard instead of leaving. Blocking only the push — rather than
   * disarming while the question is up — keeps the entry that is already there where it is, which
   * is what makes the whole thing one entry deep at any moment.
   */
  questionOpen: boolean;
  /**
   * True once a departure has been agreed and is about to happen.
   *
   * It stops the guard tidying its own entry away, because the departure is itself a navigation:
   * `router.replace` overwrites the entry it is standing on, and a Back press has already consumed
   * it. Doing both raced, and the loser was the departure — a teacher who deleted a draft watched
   * the studio stay exactly where it was.
   */
  departing: boolean;
  /** Called when a Back press was swallowed. `goBack` performs the press for real. */
  onHistoryBack: (goBack: () => void) => void;
}

/**
 * The two ways out of a web page that no confirmation sheet of ours can cover.
 *
 * ## Reload, closing the tab, the address bar
 *
 * `beforeunload` is the only hook a page gets, and what it produces is the browser's built-in
 * wording, not ours: Chrome and Safari long ago stopped letting a page choose the sentence, because
 * the feature was used to trap people. That is a fair trade for the alternative, which is a teacher
 * pressing reload on a slow connection and losing what they typed with no question asked at all.
 *
 * ## Browser Back, which does not unload anything
 *
 * This is the one the first attempt missed. Expo Router is a single page: Back fires `popstate`, the
 * router swaps the screen, and `beforeunload` never runs. Nor does React Navigation's `beforeRemove`,
 * because the router answers a browser Back with `resetRoot`, which is not a removal.
 *
 * So the guard is a **single sentinel entry**, and the discipline is that there is never more than
 * one:
 *
 * - when work goes at risk, push one history entry for the URL the teacher is already on;
 * - a Back press consumes that entry instead of leaving. The address does not change, so the studio
 *   stays exactly as it was, and `onHistoryBack` raises the question;
 * - while the question is on screen nothing new is pushed underneath it;
 * - "Keep editing" re-arms it, so the next Back is caught too;
 * - leaving for real calls the `goBack` handed to `onHistoryBack`, which is one step back from where
 *   the sentinel was — the navigation the teacher originally asked for;
 * - saving disarms it, consuming the spare entry silently so Back does not need pressing twice;
 * - and an agreed departure disarms it without consuming anything, because the navigation it is
 *   about to perform owns that entry.
 *
 * That is what keeps it from being the infinite trap this pattern usually becomes: a press either
 * consumes the one sentinel or leaves, and nothing re-arms while a question is open.
 *
 * The sentinel carries the router's own `history.state` — expo-router looks its position up by the
 * `id` in there — with one extra key. Pushing a bare object would leave that lookup unable to find
 * the current entry, and the router would think it was at the start of history.
 */
export function useBrowserLeaveGuard({
  dirty,
  armHistory,
  questionOpen,
  departing,
  onHistoryBack,
}: LeaveGuard): void {
  useEffect(() => {
    if (!dirty || typeof window === "undefined") return;
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
  }, [dirty]);

  /** Whether our spare history entry is currently on the stack. */
  const [armed, setArmed] = useState(false);
  /** Set while we are consuming our own entry, so that `popstate` is not read as a Back press. */
  const [housekeeping] = useState(() => ({ skip: false }));

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (armHistory && !armed && !questionOpen) {
      const current = window.history.state ?? {};
      window.history.pushState({ ...current, fadkoLeaveGuard: true }, "", window.location.href);
      setArmed(true);
      return;
    }
    if (!armHistory && armed) {
      if (departing) {
        // Leaving. The navigation about to run owns the entry; see `departing` above.
        setArmed(false);
        return;
      }
      // The work is safe. Take the spare entry back off the stack so a single Back press does what
      // it says rather than needing two.
      housekeeping.skip = true;
      setArmed(false);
      window.history.back();
    }
  }, [armHistory, armed, questionOpen, departing, housekeeping]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      if (housekeeping.skip) {
        housekeeping.skip = false;
        return;
      }
      if (!armed) return;
      // Our sentinel has just been consumed. The address is unchanged, so the teacher is still here.
      setArmed(false);
      onHistoryBack(() => window.history.go(-1));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [armed, housekeeping, onHistoryBack]);
}
