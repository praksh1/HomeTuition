export interface LeaveGuard {
  dirty: boolean;
  armHistory: boolean;
  questionOpen: boolean;
  departing: boolean;
  onHistoryBack: (goBack: () => void) => void;
}

/**
 * Stopping the *browser* from throwing away unsaved work — the native half, which does nothing.
 *
 * There is no reload button, no address bar, no tab to close and no browser Back on a phone, so
 * every event the file beside this one guards against is one that cannot happen here. Leaving a
 * screen on iOS or Android goes through React Navigation, which `usePreventRemove` covers on both
 * platforms, and through the app's own Back control, which checks for itself.
 *
 * Metro resolves `.web.ts` before `.ts`, so a browser gets the other file. This exists so a screen
 * can call the hook unconditionally without asking which platform it is on.
 */
export function useBrowserLeaveGuard(_guard: LeaveGuard): void {
  // Nothing to guard. Kept as a real no-op rather than an unimplemented throw: a screen calling it
  // on a phone is correct, not a mistake.
}
