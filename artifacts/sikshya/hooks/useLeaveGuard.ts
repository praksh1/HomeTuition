/**
 * Stopping the *browser* from throwing away unsaved work — the native half, which does nothing.
 *
 * There is no refresh button, no address bar and no tab to close on a phone, so the events this
 * guards against do not exist there. Leaving a screen on iOS or Android goes through React
 * Navigation, which `usePreventRemove` covers on both platforms, and through the app's own Back
 * control, which checks for itself.
 *
 * Metro resolves `.web.ts` before `.ts`, so the file beside this one is what a browser gets. This
 * exists so a screen can call the hook unconditionally without asking which platform it is on.
 */
export function useBrowserLeaveGuard(_active: boolean): void {
  // Nothing to guard. Kept as a real no-op rather than an unimplemented throw: a screen calling it
  // on a phone is correct, not a mistake.
}
