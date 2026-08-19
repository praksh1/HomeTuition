import { useCallback, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { SceneDelta } from "../hooks/useClassroomSocket";

/**
 * The same whiteboard, inside the native apps.
 *
 * Excalidraw is a browser library and iOS and Android have no DOM, so on phones it runs inside
 * a WebView. That sounds like a compromise and mostly is not: it means one board implementation
 * and one sync protocol everywhere, which is precisely what went wrong before — the web and
 * native boards drifted apart and behaved differently in the same class.
 *
 * The board is loaded from our own web deployment rather than bundled into the app. That keeps
 * a multi-megabyte editor out of the APK, and means fixing the board does not require shipping
 * a new build to the stores and waiting for review.
 *
 * The WebView is a sandbox, so nothing is shared with it implicitly: scene deltas are passed in
 * over `postMessage` and passed back out the same way. This file is the bridge and holds no
 * board logic of its own — all of that lives in `SmartBoard.web.tsx`, on the other side.
 *
 * **Known limit:** on low-end Android, WebView rendering is noticeably heavier than the native
 * SVG board was. Test on the cheapest device you can find before assuming this is fine
 * everywhere; `WHITEBOARD.md` records the fallback if it is not.
 */

interface Props {
  readOnly?: boolean;
  sceneUpdates: SceneDelta[];
  onConsumeUpdates: () => void;
  onSceneChange: (changed: unknown[]) => void;
  clearedAt?: number;
  theme?: "light" | "dark";
}

/** Where the board page is served from. Same origin as the web app. */
const BOARD_ORIGIN =
  process.env.EXPO_PUBLIC_BOARD_URL ?? "https://hometuition.praksh-dhakal.workers.dev";

export default function SmartBoard({
  readOnly = false,
  sceneUpdates,
  onConsumeUpdates,
  onSceneChange,
  clearedAt = 0,
  theme = "light",
}: Props) {
  const webRef = useRef<WebView>(null);
  const ready = useRef(false);
  /**
   * Deltas that arrived before the page finished loading.
   *
   * A student can open the classroom while the board is still starting up, and the catch-up
   * message for everything already drawn is the very first thing the server sends. Dropping it
   * would leave them looking at a blank board for the rest of the lesson.
   */
  const queued = useRef<SceneDelta[]>([]);

  const post = useCallback((msg: object) => {
    webRef.current?.postMessage(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    if (sceneUpdates.length === 0) return;
    if (!ready.current) {
      queued.current.push(...sceneUpdates);
    } else {
      for (const delta of sceneUpdates) post({ type: "scene_in", delta });
    }
    onConsumeUpdates();
  }, [sceneUpdates, onConsumeUpdates, post]);

  useEffect(() => {
    if (clearedAt === 0 || !ready.current) return;
    post({ type: "clear" });
  }, [clearedAt, post]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: { type?: string; elements?: unknown[] };
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }

      if (msg.type === "ready") {
        ready.current = true;
        post({ type: "config", readOnly, theme });
        for (const delta of queued.current) post({ type: "scene_in", delta });
        queued.current = [];
        return;
      }
      if (msg.type === "scene_out" && Array.isArray(msg.elements)) {
        onSceneChange(msg.elements);
      }
    },
    [post, readOnly, theme, onSceneChange],
  );

  const source = useMemo(
    () => ({ uri: `${BOARD_ORIGIN}/board?embed=1&readOnly=${readOnly ? "1" : "0"}&theme=${theme}` }),
    [readOnly, theme],
  );

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={source}
        onMessage={handleMessage}
        // The board is a drawing surface: the browser's own gestures would otherwise fight it.
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        // Needed for the canvas to size itself correctly on first paint.
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        // Stops iOS zooming the whole page when a teacher pinches to zoom the canvas.
        scalesPageToFit={false}
        allowsInlineMediaPlayback
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  web: { flex: 1, backgroundColor: "#FFFFFF" },
});
