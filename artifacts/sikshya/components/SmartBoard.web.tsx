import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, MainMenu, WelcomeScreen } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { SceneDelta } from "../hooks/useClassroomSocket";
import { recognizeToText, type HandwritingResult } from "./recognition/handwriting";

/**
 * The classroom whiteboard, on Excalidraw.
 *
 * The previous board drew strokes onto an SVG surface. It drew them well, but a stroke was
 * only ever a path string: there was no object to select, nothing to move or rotate, no canvas
 * beyond the visible rectangle, and no way to fix a diagram other than erasing it. Every one of
 * those is a thing teachers do constantly.
 *
 * Excalidraw was chosen over tldraw because it is MIT licensed — no watermark, no per-seat
 * cost as the school count grows — and it already provides object manipulation, an infinite
 * canvas, and smooth pan and zoom. Those are years of work not worth repeating.
 *
 * ## How the board stays in step
 *
 * The teacher's board is authoritative and students are read-only, which matches how a class
 * actually runs and removes an entire category of conflict. Changes are sent as **deltas of
 * changed elements**, not as whole scenes:
 *
 *  - A full scene on every stroke would be tens of kilobytes per message on a poor connection.
 *  - More importantly, applying a whole scene to a live editor fights it. A student's viewport
 *    would jump on every update, and any in-progress interaction would be yanked away.
 *
 * Each element carries a `version` that Excalidraw increments on every edit, and the merge rule
 * is simply "higher version wins". That makes updates commutative: a message that arrives out
 * of order cannot resurrect a deleted shape or undo a move.
 */

type ExcalidrawAPI = {
  updateScene: (scene: { elements?: readonly unknown[] }) => void;
  getSceneElements: () => readonly ExcalidrawElement[];
  getAppState: () => { selectedElementIds: Record<string, boolean> };
  scrollToContent: (target?: unknown, opts?: unknown) => void;
};

interface ExcalidrawElement {
  id: string;
  version: number;
  isDeleted?: boolean;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: [number, number][];
  [key: string]: unknown;
}

interface Props {
  /** Teachers draw; students watch. */
  readOnly?: boolean;
  /** Deltas arriving from the classroom socket. */
  sceneUpdates: SceneDelta[];
  onConsumeUpdates: () => void;
  onSceneChange: (changed: unknown[]) => void;
  /** Bumped by the server when the board is wiped at the start of a class. */
  clearedAt?: number;
  theme?: "light" | "dark";
}

/**
 * Changes are batched over a short window rather than sent per event.
 *
 * Excalidraw fires `onChange` on every pointer move, which is far more often than anyone needs
 * to see. Coalescing to ~120ms cuts the message rate by an order of magnitude while staying
 * below the threshold where a student would notice the board lagging the teacher's hand.
 */
const SYNC_INTERVAL_MS = 120;

export default function SmartBoard({
  readOnly = false,
  sceneUpdates,
  onConsumeUpdates,
  onSceneChange,
  clearedAt = 0,
  theme = "light",
}: Props) {
  const [api, setApi] = useState<ExcalidrawAPI | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * The version of each element as last broadcast.
   *
   * This is what makes delta sync possible: an element is only worth sending if its version has
   * moved since we last sent it. Without it, every change would re-broadcast the whole board.
   */
  const sentVersions = useRef<Map<string, number>>(new Map());
  const pendingSync = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Elements the server told us about, which must not be echoed straight back.
   *
   * Applying a remote update makes Excalidraw fire `onChange`, and sending that back would
   * bounce the same element between the two sides forever. Recording the versions we were
   * *given* means the next diff sees them as already sent.
   */
  const applyingRemote = useRef(false);

  // --- outgoing: what changed since last time ---
  const flush = useCallback(() => {
    pendingSync.current = null;
    if (!api || readOnly) return;

    const elements = api.getSceneElements();
    const changed: unknown[] = [];
    for (const el of elements) {
      const last = sentVersions.current.get(el.id);
      if (last === el.version) continue;
      sentVersions.current.set(el.id, el.version);
      changed.push(el);
    }
    if (changed.length > 0) onSceneChange(changed);
  }, [api, readOnly, onSceneChange]);

  const handleChange = useCallback(() => {
    if (readOnly || applyingRemote.current) return;
    if (pendingSync.current) return;
    pendingSync.current = setTimeout(flush, SYNC_INTERVAL_MS);
  }, [readOnly, flush]);

  useEffect(() => {
    return () => {
      if (pendingSync.current) clearTimeout(pendingSync.current);
    };
  }, []);

  // --- incoming: merge deltas into the live scene ---
  useEffect(() => {
    if (!api || sceneUpdates.length === 0) return;

    const current = new Map<string, ExcalidrawElement>();
    for (const el of api.getSceneElements()) current.set(el.id, el);

    let touched = false;
    for (const delta of sceneUpdates) {
      for (const raw of delta.elements) {
        const el = raw as ExcalidrawElement;
        if (!el || typeof el.id !== "string") continue;
        const existing = current.get(el.id);
        // Higher version wins, which makes out-of-order delivery harmless.
        if (existing && existing.version >= el.version) continue;
        current.set(el.id, el);
        // Treat it as already broadcast, so applying it does not echo back to the sender.
        sentVersions.current.set(el.id, el.version);
        touched = true;
      }
    }

    onConsumeUpdates();
    if (!touched) return;

    applyingRemote.current = true;
    api.updateScene({ elements: [...current.values()] });
    // Cleared on a later tick because updateScene triggers onChange synchronously.
    setTimeout(() => { applyingRemote.current = false; }, 0);
  }, [api, sceneUpdates, onConsumeUpdates]);

  // --- the server wiped the board at the start of a class ---
  useEffect(() => {
    if (!api || clearedAt === 0) return;
    sentVersions.current.clear();
    applyingRemote.current = true;
    api.updateScene({ elements: [] });
    setTimeout(() => { applyingRemote.current = false; }, 0);
  }, [api, clearedAt]);

  /**
   * Turn the selected handwriting into typed text.
   *
   * Runs entirely on the device: no API key, no per-request cost, and it works when the
   * connection does not — which in Nepal is often. English only for now, by choice.
   */
  const convertSelection = useCallback(async () => {
    if (!api || readOnly || busy) return;
    const selected = api.getAppState().selectedElementIds;
    const ids = Object.keys(selected).filter((id) => selected[id]);
    const strokes = api
      .getSceneElements()
      .filter((el) => ids.includes(el.id) && el.type === "freedraw" && !el.isDeleted);

    if (strokes.length === 0) {
      setNotice("Select some handwriting first, then tap Convert.");
      return;
    }

    setBusy(true);
    setNotice("Reading your handwriting…");
    try {
      const result: HandwritingResult = await recognizeToText(strokes);
      if (!result.text.trim()) {
        setNotice("Couldn't read that. Try writing larger, and printed rather than joined-up.");
        return;
      }

      // Replace the ink with a text element in the same place and at a size that matches how
      // large it was written, so the board does not reflow around the conversion.
      const minX = Math.min(...strokes.map((s) => s.x));
      const minY = Math.min(...strokes.map((s) => s.y));
      const height = Math.max(...strokes.map((s) => s.y + (s.height || 0))) - minY;

      const kept = api.getSceneElements().map((el) =>
        strokes.some((s) => s.id === el.id)
          ? { ...el, isDeleted: true, version: el.version + 1 }
          : el,
      );

      const text = {
        id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "text",
        x: minX,
        y: minY,
        width: Math.max(40, result.text.length * height * 0.55),
        height: Math.max(20, height),
        text: result.text,
        originalText: result.text,
        fontSize: Math.max(16, Math.min(48, height)),
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "top",
        strokeColor: (strokes[0].strokeColor as string) ?? "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        angle: 0,
        seed: Math.floor(Math.random() * 100000),
        version: 1,
        versionNonce: Math.floor(Math.random() * 100000),
        isDeleted: false,
        groupIds: [],
        frameId: null,
        roundness: null,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
        containerId: null,
        lineHeight: 1.25,
      };

      applyingRemote.current = true;
      api.updateScene({ elements: [...kept, text] });
      setTimeout(() => { applyingRemote.current = false; flush(); }, 0);
      setNotice(`Converted: "${result.text}"`);
    } catch {
      setNotice("Handwriting conversion isn't available right now.");
    } finally {
      setBusy(false);
    }
  }, [api, readOnly, busy, flush]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const initialData = useMemo(
    () => ({
      appState: {
        viewBackgroundColor: "#FFFFFF",
        currentItemStrokeWidth: 2,
      },
      scrollToContent: true,
    }),
    [],
  );

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Excalidraw
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        excalidrawAPI={(a: any) => setApi(a as ExcalidrawAPI)}
        onChange={handleChange}
        initialData={initialData}
        viewModeEnabled={readOnly}
        theme={theme}
        UIOptions={{
          canvasActions: {
            // The class owns the board; letting one person load a file over it, or change the
            // background mid-lesson, is confusing for everyone else.
            loadScene: false,
            saveToActiveFile: false,
            export: readOnly ? false : { saveFileToDisk: true },
            toggleTheme: false,
          },
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Heading>
              {readOnly ? "Your teacher's board" : "Your board — start teaching"}
            </WelcomeScreen.Center.Heading>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </Excalidraw>

      {!readOnly && (
        <button
          onClick={convertSelection}
          disabled={busy}
          title="Select handwriting, then convert it to typed text"
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            zIndex: 5,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "9px 14px",
            borderRadius: 10,
            border: "1px solid #D1D5DB",
            background: busy ? "#E5E7EB" : "#FFFFFF",
            color: "#111827",
            font: "600 13px system-ui, sans-serif",
            cursor: busy ? "default" : "pointer",
            boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          }}
        >
          {busy ? "Reading…" : "Convert to text"}
        </button>
      )}

      {notice && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 64,
            transform: "translateX(-50%)",
            zIndex: 6,
            maxWidth: "80%",
            padding: "9px 14px",
            borderRadius: 10,
            background: "rgba(17,24,39,0.92)",
            color: "#fff",
            font: "500 12.5px system-ui, sans-serif",
            textAlign: "center",
          }}
        >
          {notice}
        </div>
      )}
    </div>
  );
}
