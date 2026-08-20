import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, MainMenu, WelcomeScreen } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { BoardViewport, SceneDelta } from "../hooks/useClassroomSocket";

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
 * actually runs and removes an entire category of conflict. Three things are synchronised, and
 * a lesson only looks right when all three are:
 *
 *  1. **Which elements exist**, as deltas of changed elements rather than whole scenes. A full
 *     scene per stroke would be tens of kilobytes a message on a poor connection, and applying
 *     one to a live editor fights it — the viewport jumps and any in-progress gesture is yanked
 *     away. Each element carries a `version` that Excalidraw increments on every edit, and the
 *     merge rule is "higher version wins", which makes updates commutative: a message that
 *     arrives out of order cannot resurrect a deleted shape or undo a move.
 *
 *  2. **Which elements are gone.** Erasing does not remove an element, it flags it `isDeleted`
 *     and bumps its version — and `getSceneElements()` hides exactly those. Diffing against it
 *     meant a rubbed-out stroke produced no delta at all, so students kept every mistake the
 *     teacher had erased, stacked on top of what replaced it. The diff runs over
 *     `getSceneElementsIncludingDeleted()` so a deletion is an edit like any other.
 *
 *  3. **Where the teacher is looking.** An infinite canvas means "the same elements" is not the
 *     same as "the same view": a student whose viewport sat elsewhere had to pinch around to
 *     find work that was, to the teacher, plainly on screen. The teacher's visible rectangle is
 *     broadcast in scene coordinates and each student fits it to their own screen, which also
 *     handles a phone and a laptop having nothing like the same shape. A student who pans or
 *     zooms themselves stops following until they ask to be taken back.
 */

/** The teacher's visible rectangle, refreshed no more often than this. */
const VIEWPORT_SYNC_MS = 200;

/**
 * Changes are batched over a short window rather than sent per event.
 *
 * Excalidraw fires `onChange` on every pointer move, which is far more often than anyone needs
 * to see. Coalescing to ~120ms cuts the message rate by an order of magnitude while staying
 * below the threshold where a student would notice the board lagging the teacher's hand.
 */
const SYNC_INTERVAL_MS = 120;

/** Excalidraw's own limits. Following the teacher must never leave a student outside them. */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;

/**
 * The shape properties panel is hidden until asked for.
 *
 * Excalidraw shows it the moment a drawing tool is active and leaves it there. On a laptop it
 * is a sensible sidebar; in a classroom, where the board shares the screen with a video call,
 * it covers a quarter of the drawing surface and nothing dismisses it. It is one tap away
 * instead, and it gets out of the way again as soon as the teacher starts drawing.
 */
const BOARD_CSS = `
.sikshya-board--hide-props .App-menu__left { display: none !important; }
.sikshya-board .App-menu__left { max-height: calc(100% - 6rem); }
`;

type ExcalidrawAppState = {
  scrollX: number;
  scrollY: number;
  zoom: { value: number };
  width: number;
  height: number;
};

type ExcalidrawAPI = {
  updateScene: (scene: { elements?: readonly unknown[]; appState?: Record<string, unknown> }) => void;
  getSceneElements: () => readonly ExcalidrawElement[];
  getSceneElementsIncludingDeleted: () => readonly ExcalidrawElement[];
  getAppState: () => ExcalidrawAppState;
  /** The picture data behind image elements, keyed by file id. */
  getFiles: () => Record<string, BinaryFile>;
  addFiles: (files: BinaryFile[]) => void;
  scrollToContent: (target?: unknown, opts?: unknown) => void;
  setToast: (toast: { message: string; duration?: number; closable?: boolean } | null) => void;
};

/**
 * A picture on the board, as Excalidraw stores it.
 *
 * Excalidraw deliberately keeps this apart from the element that draws it: the element carries
 * position, size and a `fileId`, and the bytes live here. Anything syncing a board has to send
 * both — an element whose file never arrived renders as an empty picture frame, which is
 * exactly what students saw.
 */
interface BinaryFile {
  id: string;
  dataURL: string;
  mimeType: string;
  created: number;
  lastRetrieved?: number;
}

/** Only the fields the sync rules reason about; everything else is carried through untouched. */
interface ExcalidrawElement {
  id: string;
  version: number;
  isDeleted?: boolean;
  [key: string]: unknown;
}

interface Props {
  /** Teachers draw; students watch. */
  readOnly?: boolean;
  /** Deltas arriving from the classroom socket. */
  sceneUpdates: SceneDelta[];
  onConsumeUpdates: () => void;
  onSceneChange: (changed: unknown[], files: unknown[]) => void;
  /**
   * A picture to place on the board. Changing `key` places it; the same key is never placed
   * twice, so a re-render cannot duplicate it.
   */
  insertImage?: { key: string; dataUrl: string } | null;
  /** Teacher only: publishes the part of the canvas they are looking at. */
  onViewportChange?: (view: BoardViewport) => void;
  /** Students only: the part of the canvas the teacher is looking at. */
  viewport?: BoardViewport | null;
  /** Teacher only: wipe the board for the whole class. */
  onClearAll?: () => void;
  /** Bumped by the server when the board is wiped at the start of a class. */
  clearedAt?: number;
  theme?: "light" | "dark";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** True when two rectangles are close enough that resending would tell nobody anything. */
function sameView(a: BoardViewport | null, b: BoardViewport): boolean {
  if (!a) return false;
  return (
    Math.abs(a.minX - b.minX) < 1 &&
    Math.abs(a.minY - b.minY) < 1 &&
    Math.abs(a.maxX - b.maxX) < 1 &&
    Math.abs(a.maxY - b.maxY) < 1
  );
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const SlidersIcon = () => (
  <svg {...iconProps} aria-hidden="true">
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </svg>
);

const TrashIcon = () => (
  <svg {...iconProps} aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const EyeIcon = () => (
  <svg {...iconProps} aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export default function SmartBoard({
  readOnly = false,
  sceneUpdates,
  onConsumeUpdates,
  onSceneChange,
  onViewportChange,
  viewport = null,
  insertImage = null,
  onClearAll,
  clearedAt = 0,
  theme = "light",
}: Props) {
  const [api, setApi] = useState<ExcalidrawAPI | null>(null);
  /** Whether Excalidraw's shape properties panel is currently allowed on screen. */
  const [showProps, setShowProps] = useState(false);
  /** Students only: whether the board still tracks the teacher's view. */
  const [following, setFollowing] = useState(true);

  /**
   * The version of each element as last broadcast.
   *
   * This is what makes delta sync possible: an element is only worth sending if its version has
   * moved since we last sent it. Without it, every change would re-broadcast the whole board.
   */
  const sentVersions = useRef<Map<string, number>>(new Map());
  /** Pictures already put on the wire. They are large and never change once created. */
  const sentFiles = useRef<Set<string>>(new Set());
  const insertedImages = useRef<Set<string>>(new Set());
  const pendingSync = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingView = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingApply = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentView = useRef<BoardViewport | null>(null);
  /** The viewport this board was last moved to on the teacher's behalf. */
  const appliedView = useRef<{ scrollX: number; scrollY: number; zoom: number } | null>(null);
  /** Set once a student's board has been pointed at something, so it is only auto-fitted once. */
  const fitted = useRef(false);
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

    // Deleted elements included, deliberately: erasing is an edit, and a board that only ever
    // reports additions leaves every student looking at work the teacher rubbed out.
    const elements = api.getSceneElementsIncludingDeleted();
    const changed: unknown[] = [];
    for (const el of elements) {
      const last = sentVersions.current.get(el.id);
      if (last === el.version) continue;
      sentVersions.current.set(el.id, el.version);
      changed.push(el);
    }

    // An image element is a frame and a reference; the picture itself lives in a separate map
    // and has to travel with it, once. Without this a student gets the frame and no picture,
    // and resizing it on the teacher's board just gives them a bigger empty frame.
    const files: unknown[] = [];
    const available = api.getFiles();
    for (const el of changed as ExcalidrawElement[]) {
      const fileId = typeof el.fileId === "string" ? el.fileId : null;
      if (!fileId || sentFiles.current.has(fileId)) continue;
      const file = available[fileId];
      if (!file) continue;
      sentFiles.current.add(fileId);
      files.push(file);
    }

    if (changed.length > 0) onSceneChange(changed, files);
  }, [api, readOnly, onSceneChange]);

  // --- outgoing: where the teacher is looking ---
  const publishViewport = useCallback(() => {
    pendingView.current = null;
    if (!api || readOnly || !onViewportChange) return;

    const state = api.getAppState();
    const zoom = state.zoom?.value ?? 1;
    if (!(zoom > 0) || !(state.width > 0) || !(state.height > 0)) return;

    const view: BoardViewport = {
      minX: -state.scrollX,
      minY: -state.scrollY,
      maxX: -state.scrollX + state.width / zoom,
      maxY: -state.scrollY + state.height / zoom,
    };
    if (sameView(sentView.current, view)) return;
    sentView.current = view;
    onViewportChange(view);
  }, [api, readOnly, onViewportChange]);

  const scheduleViewportPublish = useCallback(() => {
    if (readOnly || pendingView.current) return;
    pendingView.current = setTimeout(publishViewport, VIEWPORT_SYNC_MS);
  }, [readOnly, publishViewport]);

  const handleChange = useCallback(() => {
    if (readOnly || applyingRemote.current) return;
    // Drawing at the edge of the screen scrolls the canvas, so the view is worth re-checking
    // on any change; `publishViewport` drops it again if the rectangle has not moved.
    scheduleViewportPublish();
    if (pendingSync.current) return;
    pendingSync.current = setTimeout(flush, SYNC_INTERVAL_MS);
  }, [readOnly, flush, scheduleViewportPublish]);

  // Publish the opening view as soon as the board is up, so a student arriving later is put
  // where the teacher already is rather than at an arbitrary corner of an infinite canvas.
  useEffect(() => {
    if (!api || readOnly) return;
    scheduleViewportPublish();
  }, [api, readOnly, scheduleViewportPublish]);

  useEffect(() => {
    return () => {
      if (pendingSync.current) clearTimeout(pendingSync.current);
      if (pendingView.current) clearTimeout(pendingView.current);
      if (pendingApply.current) clearTimeout(pendingApply.current);
    };
  }, []);

  // --- incoming: follow the teacher's view ---
  const applyViewport = useCallback<(view: BoardViewport) => void>(
    (view) => {
      if (!api) return;
      if (pendingApply.current) {
        clearTimeout(pendingApply.current);
        pendingApply.current = null;
      }

      const state = api.getAppState();
      const w = state.width;
      const h = state.height;
      // The very first view usually arrives with the catch-up, which can beat the canvas being
      // measured. Dropping it there would leave the student stranded until the teacher next
      // moved — the exact thing this is here to prevent — so it waits for a size instead.
      if (!(w > 0) || !(h > 0)) {
        pendingApply.current = setTimeout(() => applyViewport(view), 120);
        return;
      }

      const viewW = Math.max(1, view.maxX - view.minX);
      const viewH = Math.max(1, view.maxY - view.minY);
      // Fit the teacher's rectangle inside ours. Their screen is rarely the same shape as a
      // student's, and fitting rather than copying guarantees everything they can see is on
      // screen here too, with the spare room going to the axis that has it.
      const zoom = clamp(Math.min(w / viewW, h / viewH), MIN_ZOOM, MAX_ZOOM);
      const centerX = (view.minX + view.maxX) / 2;
      const centerY = (view.minY + view.maxY) / 2;
      const scrollX = w / (2 * zoom) - centerX;
      const scrollY = h / (2 * zoom) - centerY;

      appliedView.current = { scrollX, scrollY, zoom };
      fitted.current = true;
      applyingRemote.current = true;
      api.updateScene({ appState: { scrollX, scrollY, zoom: { value: zoom } } });
      setTimeout(() => { applyingRemote.current = false; }, 0);
    },
    [api],
  );

  useEffect(() => {
    if (!api || !readOnly || !viewport || !following) return;
    applyViewport(viewport);
  }, [api, readOnly, viewport, following, applyViewport]);

  /**
   * A student who pans or zooms has taken over their own view.
   *
   * Snapping them back on the teacher's next stroke would make the board unusable for anyone
   * reading a detail, so following stops and a button offers it back.
   */
  const handleScrollChange = useCallback(
    (scrollX: number, scrollY: number, zoom: { value: number }) => {
      if (!readOnly) {
        scheduleViewportPublish();
        return;
      }
      const applied = appliedView.current;
      if (!applied) return;
      const moved =
        Math.abs(applied.scrollX - scrollX) > 1 ||
        Math.abs(applied.scrollY - scrollY) > 1 ||
        Math.abs(applied.zoom - zoom.value) > 0.01;
      if (moved) setFollowing(false);
    },
    [readOnly, scheduleViewportPublish],
  );

  const resumeFollowing = useCallback(() => {
    setFollowing(true);
    if (viewport) applyViewport(viewport);
  }, [viewport, applyViewport]);

  // --- incoming: merge deltas into the live scene ---
  useEffect(() => {
    if (!api || sceneUpdates.length === 0) return;

    // Deleted elements are kept in the map rather than dropped. They are the record that
    // something was erased: without them a late-arriving stale update would put it back.
    const current = new Map<string, ExcalidrawElement>();
    for (const el of api.getSceneElementsIncludingDeleted()) current.set(el.id, el);

    // Pictures first. Excalidraw renders an image element the moment it appears, so handing it
    // the element before the bytes shows an empty frame that only corrects itself on the next
    // change — and there may not be one.
    const incomingFiles: BinaryFile[] = [];
    for (const delta of sceneUpdates) {
      for (const raw of delta.files ?? []) {
        const file = raw as BinaryFile;
        if (!file || typeof file.id !== "string" || typeof file.dataURL !== "string") continue;
        sentFiles.current.add(file.id);
        incomingFiles.push(file);
      }
    }
    if (incomingFiles.length > 0) api.addFiles(incomingFiles);

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

    // Fallback for the first content to arrive before the teacher has published a view —
    // better to be pointed at the work than at an empty stretch of canvas.
    if (readOnly && !fitted.current && !viewport) {
      const visible = [...current.values()].filter((el) => !el.isDeleted);
      if (visible.length > 0) {
        fitted.current = true;
        api.scrollToContent(visible, { fitToContent: true, animate: false, maxZoom: 1 });
      }
    }
  }, [api, sceneUpdates, onConsumeUpdates, readOnly, viewport]);

  // --- the server wiped the board at the start of a class ---
  useEffect(() => {
    if (!api || clearedAt === 0) return;
    sentVersions.current.clear();
    sentFiles.current.clear();
    applyingRemote.current = true;
    api.updateScene({ elements: [] });
    setTimeout(() => { applyingRemote.current = false; }, 0);
  }, [api, clearedAt]);

  /**
   * Wipe the board for the whole class.
   *
   * Erasing is per-object and fine for a correction, but a teacher moving to the next problem
   * wants the surface back, and Excalidraw's own "reset canvas" only empties the local copy —
   * every student would have kept the whole lesson on screen. This clears here and tells the
   * server, which is what makes it mean the same thing for everyone.
   */
  const clearAll = useCallback(() => {
    if (!api || readOnly) return;
    if (typeof window !== "undefined" && !window.confirm("Clear the whiteboard for the whole class?")) {
      return;
    }
    sentVersions.current.clear();
    sentFiles.current.clear();
    applyingRemote.current = true;
    api.updateScene({ elements: [] });
    setTimeout(() => { applyingRemote.current = false; }, 0);
    onClearAll?.();
    api.setToast({ message: "Board cleared", duration: 2000 });
  }, [api, readOnly, onClearAll]);

  /**
   * Put an uploaded picture on the board as a real element.
   *
   * It used to be drawn *behind* the canvas and annotated over the top, which meant it could
   * not be moved or scaled with the diagram, was not part of what a student's view is fitted
   * to, and on a screen of a different shape did not line up with the ink at all. As an element
   * it is just another object: draggable, resizable, erasable, and synced by the same rules as
   * everything else.
   */
  useEffect(() => {
    if (!api || readOnly || !insertImage) return;
    if (insertedImages.current.has(insertImage.key)) return;
    insertedImages.current.add(insertImage.key);

    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return;
      const state = api.getAppState();
      const zoom = state.zoom?.value ?? 1;
      const viewW = (state.width || 800) / zoom;
      const viewH = (state.height || 600) / zoom;

      // Fill most of what the teacher is looking at, without overflowing it.
      const scale = Math.min(1, (viewW * 0.8) / img.naturalWidth, (viewH * 0.8) / img.naturalHeight);
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const x = -state.scrollX + (viewW - width) / 2;
      const y = -state.scrollY + (viewH - height) / 2;

      const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const mimeMatch = /^data:([^;,]+)[;,]/.exec(insertImage.dataUrl);
      api.addFiles([
        {
          id: fileId,
          dataURL: insertImage.dataUrl,
          mimeType: mimeMatch ? mimeMatch[1] : "image/jpeg",
          created: Date.now(),
        },
      ]);

      const element = {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "image",
        fileId,
        status: "saved",
        x, y, width, height,
        angle: 0,
        strokeColor: "transparent",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: Math.floor(Math.random() * 100000),
        version: 1,
        versionNonce: Math.floor(Math.random() * 100000),
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
        scale: [1, 1],
        crop: null,
      };

      applyingRemote.current = true;
      api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), element] });
      setTimeout(() => {
        applyingRemote.current = false;
        // Point everyone at it — the teacher's view is broadcast, so students come along.
        api.scrollToContent([element], { fitToContent: true, animate: false, maxZoom: 1 });
        flush();
      }, 0);
    };
    img.onerror = () => {
      if (!cancelled) api.setToast({ message: "That picture could not be opened.", duration: 4000 });
    };
    img.src = insertImage.dataUrl;

    return () => { cancelled = true; };
  }, [api, readOnly, insertImage, flush]);

  /** Show or hide the shape properties panel, in whichever layout Excalidraw is using. */
  const setPropsVisible = useCallback(
    (visible: boolean) => {
      setShowProps(visible);
      // On a narrow screen the panel is a sheet driven by `openMenu` rather than the sidebar
      // the stylesheet above controls, so both have to be moved together.
      api?.updateScene({ appState: { openMenu: visible ? "shape" : null } });
    },
    [api],
  );

  /** Anything drawn on the canvas dismisses the panel — that is the whole point of it. */
  const handlePointerDown = useCallback(() => {
    if (showProps) setPropsVisible(false);
  }, [showProps, setPropsVisible]);

  const renderTopRightUI = useCallback(() => {
    if (readOnly) return null;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          onClick={() => setPropsVisible(!showProps)}
          title="Colour, stroke and shape styles"
          aria-label="Colour, stroke and shape styles"
          aria-pressed={showProps}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid var(--default-border-color, #E5E7EB)",
            background: showProps ? "var(--color-primary, #6965DB)" : "var(--island-bg-color, #FFFFFF)",
            color: showProps ? "#FFFFFF" : "var(--text-primary-color, #1B1B1F)",
            cursor: "pointer",
          }}
        >
          <SlidersIcon />
        </button>
        <button
          type="button"
          onClick={clearAll}
          title="Clear the board for the whole class"
          aria-label="Clear the board for the whole class"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid var(--default-border-color, #E5E7EB)",
            background: "var(--island-bg-color, #FFFFFF)",
            color: "#C2410C",
            cursor: "pointer",
          }}
        >
          <TrashIcon />
        </button>
      </div>
    );
  }, [readOnly, showProps, setPropsVisible, clearAll]);

  const initialData = useMemo(
    () => ({
      appState: {
        // Transparent rather than white: an uploaded photo or worksheet is rendered behind the
        // board, and a painted background would hide the very thing being annotated.
        viewBackgroundColor: "transparent",
        currentItemStrokeWidth: 2,
      },
      scrollToContent: true,
    }),
    [],
  );

  return (
    <div
      className={`sikshya-board${showProps ? "" : " sikshya-board--hide-props"}`}
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      <style>{BOARD_CSS}</style>
      <Excalidraw
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        excalidrawAPI={(a: any) => setApi(a as ExcalidrawAPI)}
        onChange={handleChange}
        onScrollChange={handleScrollChange}
        onPointerDown={handlePointerDown}
        initialData={initialData}
        viewModeEnabled={readOnly}
        theme={theme}
        renderTopRightUI={renderTopRightUI}
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
          {!readOnly && (
            <MainMenu.Item onSelect={clearAll} icon={<TrashIcon />}>
              Clear board for everyone
            </MainMenu.Item>
          )}
          <MainMenu.DefaultItems.SaveAsImage />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Heading>
              {readOnly ? "Your teacher's board" : "Your board — start teaching"}
            </WelcomeScreen.Center.Heading>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </Excalidraw>

      {readOnly && !following && (
        <button
          type="button"
          onClick={resumeFollowing}
          style={{
            position: "absolute",
            left: "50%",
            bottom: 16,
            transform: "translateX(-50%)",
            zIndex: 6,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 999,
            border: "none",
            background: "rgba(17,24,39,0.92)",
            color: "#fff",
            font: "600 12.5px system-ui, sans-serif",
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          }}
        >
          <EyeIcon />
          Follow the teacher
        </button>
      )}
    </div>
  );
}
