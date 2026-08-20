import { AppState, Platform } from "react-native";

/**
 * Calls back when this device has plausibly just got its connection back.
 *
 * Without this, a reconnect only happens when a timer the app set earlier happens to fire. A
 * student who walks back into signal, or unlocks their phone, therefore waits out whatever
 * delay was chosen while they were offline — the app has the information that things are
 * working again and does nothing with it.
 *
 * Two signals, because neither covers both platforms honestly:
 *
 * - The browser's `online` event, which fires when the OS reports a network again.
 * - The app returning to the foreground, which on a phone is the moment that matters: a
 *   backgrounded app has its sockets torn down by the operating system, and the user is
 *   looking at the screen expecting it to work.
 *
 * Returns a function that removes both.
 */
export function onNetworkResume(callback: () => void): () => void {
  const cleanups: Array<() => void> = [];

  if (Platform.OS === "web" && typeof window !== "undefined") {
    const onOnline = () => callback();
    window.addEventListener("online", onOnline);
    cleanups.push(() => window.removeEventListener("online", onOnline));

    // A laptop waking from sleep does not always fire `online`, but it does become visible.
    const onVisible = () => {
      if (document.visibilityState === "visible") callback();
    };
    document.addEventListener("visibilitychange", onVisible);
    cleanups.push(() => document.removeEventListener("visibilitychange", onVisible));
  }

  const sub = AppState.addEventListener("change", (state) => {
    if (state === "active") callback();
  });
  cleanups.push(() => sub.remove());

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
