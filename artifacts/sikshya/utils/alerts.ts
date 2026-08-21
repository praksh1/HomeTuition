import { Alert, Platform } from "react-native";

/**
 * Telling someone something, on every platform this app runs on.
 *
 * `Alert` is a React Native module and **react-native-web does not implement it** — on the web
 * `Alert.alert(...)` returns silently and nothing appears. Everyone using this product today is
 * on a browser, so every screen that reached for it had a button that did nothing at all:
 * "Log Out" in both profiles, the confirmation after uploading credentials, "Already booked",
 * the rating thank-you, the support form's success and failure messages. Fifteen of them.
 *
 * Reported as "the + Add button does not do anything", which was one of the fifteen and the
 * least important — nobody had yet noticed they could not log out.
 *
 * The classroom had already worked this out and branched on `Platform.OS` inline every time it
 * needed to say something. This is that, in one place, so the next screen cannot forget.
 */
export function notify(title: string, message?: string): void {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

/**
 * Asking before doing something that cannot be undone.
 *
 * Returns what the person chose, rather than taking callbacks, so the caller reads in the order
 * it happens: ask, then act. On the web this is the browser's own confirm dialog; on a phone it
 * is a two-button alert.
 */
export function confirm(title: string, message?: string, confirmLabel = "OK"): Promise<boolean> {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      // Cancel first so a stray tap on a phone is the harmless one.
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}
