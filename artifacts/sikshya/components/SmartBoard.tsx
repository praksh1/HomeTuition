import { useCallback, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { BoardViewport, SceneDelta } from "../hooks/useClassroomSocket";

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
  onSceneChange: (changed: unknown[], files: unknown[]) => void;
  onViewportChange?: (view: BoardViewport) => void;
  insertDocument?: { key: string; dataUrl: string; kind: "image" | "pdf" } | null;
  /**
   * Called when a document was posted to the board and the board never said it arrived.
   * Silence here is the failure this exists to make visible — see the delivery note below.
   */
  onDocumentLost?: () => void;
  viewport?: BoardViewport | null;
  onClearAll?: () => void;
  clearedAt?: number;
  theme?: "light" | "dark";
}

/** Where the board page is served from. Same origin as the web app. */
const BOARD_ORIGIN =
  process.env.EXPO_PUBLIC_BOARD_URL ?? "https://hometuition.praksh-dhakal.workers.dev";

/**
 * How long to wait for the board to say a document arrived.
 *
 * Long enough that a budget Android parsing a multi-megabyte message is never accused of losing
 * it, short enough that a teacher is not left guessing. A false alarm here would be worse than
 * a slow truth, so it errs long.
 */
const DELIVERY_DEADLINE_MS = 15_000;

export default function SmartBoard({
  readOnly = false,
  sceneUpdates,
  onConsumeUpdates,
  onSceneChange,
  onViewportChange,
  viewport = null,
  insertDocument = null,
  onDocumentLost,
  onClearAll,
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
  /** The teacher's view, held the same way and for the same reason as the deltas above. */
  const queuedView = useRef<BoardViewport | null>(null);
  /**
   * A document posted to the board that has not been acknowledged yet.
   *
   * Everything else crossing this bridge is small. A shared picture or PDF is not: an 8 MB PDF
   * is around 11 MB once base64-encoded, and a message that size can be dropped on its way into
   * the WebView rather than refused. From out here that is indistinguishable from a board still
   * working — no error, no pages, nothing — which is the worst way for this to fail on a phone
   * in front of a class. The board acknowledges a document the moment it has it; silence past
   * the deadline means it never arrived.
   */
  const pendingDocument = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);

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

  /**
   * Held in a ref so that this effect depends on the document and nothing else.
   *
   * The classroom passes an inline arrow, which is a new function on every render. Depending
   * on it directly would re-run the effect each time — re-posting the whole document across
   * the bridge, several megabytes at a time, and resetting the deadline so it could never fire.
   * That is the opposite of what the deadline is for.
   */
  const documentLost = useRef(onDocumentLost);
  useEffect(() => {
    documentLost.current = onDocumentLost;
  }, [onDocumentLost]);

  useEffect(() => {
    if (!insertDocument || !ready.current) return;
    post({ type: "insert_document", document: insertDocument });

    const key = insertDocument.key;
    if (pendingDocument.current) clearTimeout(pendingDocument.current.timer);
    pendingDocument.current = {
      key,
      timer: setTimeout(() => {
        pendingDocument.current = null;
        documentLost.current?.();
      }, DELIVERY_DEADLINE_MS),
    };
  }, [insertDocument, post]);

  // A board being torn down owes nobody a warning about a document it is no longer waiting for.
  useEffect(
    () => () => {
      if (pendingDocument.current) clearTimeout(pendingDocument.current.timer);
      pendingDocument.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!viewport) return;
    if (!ready.current) queuedView.current = viewport;
    else post({ type: "view_in", view: viewport });
  }, [viewport, post]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: { type?: string; key?: string; elements?: unknown[]; files?: unknown[]; view?: BoardViewport };
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
        if (queuedView.current) {
          post({ type: "view_in", view: queuedView.current });
          queuedView.current = null;
        }
        return;
      }
      if (msg.type === "document_in") {
        const pending = pendingDocument.current;
        if (pending && pending.key === msg.key) {
          clearTimeout(pending.timer);
          pendingDocument.current = null;
        }
        return;
      }
      if (msg.type === "scene_out" && Array.isArray(msg.elements)) {
        onSceneChange(msg.elements, Array.isArray(msg.files) ? msg.files : []);
        return;
      }
      if (msg.type === "view_out" && msg.view) {
        onViewportChange?.(msg.view);
        return;
      }
      if (msg.type === "clear_out") {
        onClearAll?.();
      }
    },
    [post, readOnly, theme, onSceneChange, onViewportChange, onClearAll],
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
