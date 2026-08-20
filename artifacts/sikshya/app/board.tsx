import { useCallback, useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import SmartBoard from "../components/SmartBoard.web";
import type { BoardViewport, SceneDelta } from "../hooks/useClassroomSocket";

/**
 * The whiteboard on its own, with no classroom around it.
 *
 * This page exists so the native apps can show the identical board: `SmartBoard.tsx` points a
 * WebView at this URL, and the two sides talk over `postMessage`. Loading it from the web
 * deployment rather than bundling a copy into the app keeps a multi-megabyte editor out of the
 * APK, and means a fix to the board reaches phones without a new store release.
 *
 * It holds no networking of its own. The app on the other side of the bridge owns the classroom
 * socket and simply relays: deltas in, changes out. That keeps exactly one implementation of the
 * sync rules, in the hook, instead of a second copy here that would drift.
 */
export default function BoardPage() {
  const params = useLocalSearchParams<{ readOnly?: string; theme?: string }>();
  const [readOnly, setReadOnly] = useState(params.readOnly === "1");
  const [theme, setTheme] = useState<"light" | "dark">(params.theme === "dark" ? "dark" : "light");
  const [updates, setUpdates] = useState<SceneDelta[]>([]);
  const [clearedAt, setClearedAt] = useState(0);
  const [viewport, setViewport] = useState<BoardViewport | null>(null);
  const [insertImage, setInsertImage] = useState<{ key: string; dataUrl: string } | null>(null);

  /** Messages from the host app. */
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const onMessage = (event: MessageEvent | Event) => {
      const data = (event as MessageEvent).data;
      if (typeof data !== "string") return;
      let msg: {
        type?: string;
        delta?: SceneDelta;
        readOnly?: boolean;
        theme?: "light" | "dark";
        view?: BoardViewport;
        image?: { key: string; dataUrl: string };
      };
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "config":
          if (typeof msg.readOnly === "boolean") setReadOnly(msg.readOnly);
          if (msg.theme) setTheme(msg.theme);
          break;
        case "scene_in":
          if (msg.delta) setUpdates((prev) => [...prev, msg.delta as SceneDelta]);
          break;
        case "view_in":
          if (msg.view) setViewport(msg.view);
          break;
        case "insert_image":
          if (msg.image) setInsertImage(msg.image);
          break;
        case "clear":
          setUpdates([]);
          setClearedAt(Date.now());
          break;
      }
    };

    // Android delivers WebView messages on `document`, iOS on `window`. Listening to both is
    // the documented way to cover the pair without branching on platform.
    window.addEventListener("message", onMessage);
    document.addEventListener("message", onMessage as EventListener);

    // Announce readiness only once the listeners are attached, so the host's opening burst —
    // which includes the catch-up for everything already on the board — cannot be missed.
    const host = (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } })
      .ReactNativeWebView;
    host?.postMessage(JSON.stringify({ type: "ready" }));

    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("message", onMessage as EventListener);
    };
  }, []);

  const postToHost = useCallback((msg: object) => {
    const host = (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } })
      .ReactNativeWebView;
    host?.postMessage(JSON.stringify(msg));
  }, []);

  const handleSceneChange = useCallback(
    (changed: unknown[], files: unknown[]) => postToHost({ type: "scene_out", elements: changed, files }),
    [postToHost],
  );

  const handleViewportChange = useCallback(
    (view: BoardViewport) => postToHost({ type: "view_out", view }),
    [postToHost],
  );

  const handleClearAll = useCallback(() => postToHost({ type: "clear_out" }), [postToHost]);

  const consume = useCallback(() => setUpdates([]), []);

  if (Platform.OS !== "web") {
    // Reachable only if someone deep-links to this route inside the app itself; the real board
    // there is the WebView, not this page.
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>The whiteboard opens inside a class.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SmartBoard
        readOnly={readOnly}
        sceneUpdates={updates}
        onConsumeUpdates={consume}
        onSceneChange={handleSceneChange}
        onViewportChange={handleViewportChange}
        viewport={viewport}
        insertImage={insertImage}
        onClearAll={handleClearAll}
        clearedAt={clearedAt}
        theme={theme}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FFFFFF" },
  fallback: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  fallbackText: { color: "#666", fontSize: 14 },
});
