import { Linking, Platform } from "react-native";
import { apiGet } from "./api";

/**
 * Open a file somebody attached — a question sheet, a marked-up copy, evidence on a report.
 *
 * ### Why this is not two lines at each call site
 *
 * It was, in three places, and all three were broken on the phone the owner actually uses.
 *
 * The link has to be fetched before it can be opened: the server checks who is asking, then
 * signs a link that dies in ten minutes. That fetch is asynchronous, and **`window.open` after
 * an `await` is blocked by Safari** — by then the tap that would have justified a new tab is
 * over, and a browser will not open a window for code that is no longer answering a gesture.
 * Nothing happens, no error is thrown, and the file simply never opens.
 *
 * The way round it is to claim the tab *while the tap is still live*, before any awaiting, and
 * point it at the link once it arrives. If even that is refused, the current tab is used
 * instead — worse, because the person loses their place, but far better than a button that
 * does nothing.
 */
export interface OpenResult {
  ok: boolean;
  /** Why it did not open, in words that can go straight on the screen. */
  reason?: string;
}

export async function openAttachment(fileKey: string): Promise<OpenResult> {
  /**
   * Claimed first, before anything is awaited. This line is the whole fix.
   *
   * `about:blank` opens instantly and is replaced the moment the real link arrives. Doing it
   * after the fetch is what Safari refuses.
   */
  const tab = Platform.OS === "web" ? window.open("", "_blank") : null;

  try {
    const { url } = await apiGet<{ url: string }>(`/storage/file?key=${encodeURIComponent(fileKey)}`);
    if (!url) throw new Error("No link came back for that file.");

    if (Platform.OS !== "web") {
      await Linking.openURL(url);
      return { ok: true };
    }

    if (tab && !tab.closed) {
      tab.location.href = url;
    } else {
      // The tab was refused even inside the gesture. Going in the current one still opens the
      // file, and losing your place beats a button that does nothing.
      window.location.href = url;
    }
    return { ok: true };
  } catch (err) {
    // A blank tab left behind is a confusing thing to hand somebody after a failure.
    if (tab && !tab.closed) tab.close();
    return {
      ok: false,
      reason: err instanceof Error && err.message ? err.message : "We could not open that file.",
    };
  }
}
