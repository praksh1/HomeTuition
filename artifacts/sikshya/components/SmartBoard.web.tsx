import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Excalidraw,
  MainMenu,
  WelcomeScreen,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { BOARD_INK_COLORS } from "../constants/boardInk";
import { useColors } from "../hooks/useColors";
import type { BoardLaserPoint, BoardPage, BoardPageCommand, BoardTemplate, BoardViewport, SceneDelta } from "../hooks/useClassroomSocket";
import { LASER_THROTTLE_MS, normalizeLaserPoint } from "../utils/whiteboardLaser";
import { teachingLibrary } from "./boardLibrary";
import { isShareableSize, shrinkForSharing } from "../utils/boardImage";
import { boardScenePackets } from "../utils/boardScenePackets";
import {
  protectBoardElementsFromEraser,
  rememberVisibleBoardElements,
} from "../utils/boardEraser";

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
 *     stays on the teacher's current page and viewport throughout the lesson.
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

const TEMPLATE_LABELS: Record<BoardTemplate, string> = {
  blank: "Blank",
  lined: "Lined",
  graph: "Graph",
  dots: "Dot grid",
  "math-grid": "Math grid",
  coordinate: "Coordinate plane",
  "music-staff": "Music staff",
};

function templateStyle(template: BoardTemplate): React.CSSProperties {
  const paper = "rgba(255,255,255,0.96)";
  const ink = "rgba(37,99,235,0.13)";
  switch (template) {
    case "lined":
      return { backgroundColor: paper, backgroundImage: `repeating-linear-gradient(0deg, transparent 0 31px, ${ink} 32px)` };
    case "graph":
      return { backgroundColor: paper, backgroundImage: `linear-gradient(${ink} 1px, transparent 1px), linear-gradient(90deg, ${ink} 1px, transparent 1px)`, backgroundSize: "32px 32px" };
    case "dots":
      return { backgroundColor: paper, backgroundImage: `radial-gradient(${ink} 1.2px, transparent 1.2px)`, backgroundSize: "24px 24px" };
    case "math-grid":
      return { backgroundColor: paper, backgroundImage: `linear-gradient(${ink} 1px, transparent 1px), linear-gradient(90deg, ${ink} 1px, transparent 1px)`, backgroundSize: "20px 20px" };
    case "coordinate":
      return { backgroundColor: paper, backgroundImage: `linear-gradient(${ink} 1px, transparent 1px), linear-gradient(90deg, ${ink} 1px, transparent 1px), linear-gradient(rgba(37,99,235,0.24) 2px, transparent 2px), linear-gradient(90deg, rgba(37,99,235,0.24) 2px, transparent 2px)`, backgroundSize: "24px 24px, 24px 24px, 120px 120px, 120px 120px" };
    case "music-staff":
      return { backgroundColor: paper, backgroundImage: `repeating-linear-gradient(0deg, transparent 0 20px, ${ink} 21px, transparent 22px)` };
    default:
      return { backgroundColor: paper };
  }
}

function pageThumbnailStyle(template: BoardTemplate, active: boolean): React.CSSProperties {
  return {
    ...templateStyle(template),
    width: 52,
    height: 38,
    flexShrink: 0,
    borderRadius: 7,
    border: active ? "2px solid var(--color-primary, navy)" : "1px solid rgba(15,23,42,0.16)",
    boxShadow: active ? "0 0 0 2px var(--color-primary-light, aliceblue)" : "none",
  };
}

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
.sikshya-board .Toast { bottom: 148px; max-width: calc(100% - 24px); left: 50%; margin-left: 0; transform: translateX(-50%); pointer-events: none; }
.sikshya-board--panel-open .Toast { visibility: hidden; }

/*
 * On a phone these two buttons must not be in the toolbar row.
 *
 * Measured on an iPhone-sized viewport: Excalidraw's own toolbar is 373px, these add 70px,
 * and the row is centred in a 393px screen — so 27px is lost off *each* side and the
 * Selection tool ends up at x = -23, entirely off-screen. A teacher on a phone could not
 * select, move or resize anything, which is most of what the board is for.
 *
 * Nothing is lost by hiding them here: Excalidraw's mobile layout already carries both.
 * "Clear board for everyone" is in the hamburger menu, and the style sheet opens from the
 * palette in the bottom bar. They exist at all because on a *laptop* the properties panel
 * covers a quarter of the canvas and nothing dismisses it — a problem the mobile layout,
 * which uses a dismissable bottom sheet, does not have.
 */
.excalidraw--mobile .sikshya-board__top-right { display: none !important; }
.sikshya-board__top-right .sikshya-board__history { display: none !important; }
.sikshya-board--classroom .sikshya-board__editor { top: 56px !important; }
.sikshya-board--classroom > .sikshya-board__history { top: 4px !important; right: 8px !important; box-shadow: none !important; padding: 0 !important; gap: 4px !important; border: 0 !important; }
.sikshya-board--classroom > .sikshya-board__history > button { width: 44px; min-width: 44px; height: 44px; padding: 0; }
@media (min-width: 1440px) {
  .sikshya-board--classroom .sikshya-board__editor { top: 0 !important; }
  .sikshya-board--classroom > .sikshya-board__history { display: none !important; }
  .sikshya-board--classroom .sikshya-board__top-right .sikshya-board__history { display: flex !important; position: relative !important; top: auto !important; right: auto !important; padding: 0 !important; box-shadow: none !important; border: 0 !important; gap: 4px !important; }
  .sikshya-board--classroom .sikshya-board__top-right .sikshya-board__history > button { width: 44px; min-width: 44px; height: 44px; padding: 0; }
}
.sikshya-board__pages button { transition: background-color 140ms ease, border-color 140ms ease, transform 140ms ease, opacity 140ms ease; }
.sikshya-board__pages button:not(:disabled):hover { transform: translateY(-1px); }
.sikshya-board__pages button:disabled { cursor: default !important; opacity: 0.38; }
@media (max-width: 600px) {
  .sikshya-board__pages > button[aria-label="Previous board page"],
  .sikshya-board__pages > button[aria-label="Next board page"] { display: none; }
  .sikshya-board__page-label { min-width: 98px !important; }
}
@media (max-width: 360px) {
  .sikshya-board__thumb-toggle[aria-label="Show board page thumbnails"] { display: none !important; }
  .sikshya-board__page-label { min-width: 88px !important; max-width: 112px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
`;

type ExcalidrawAppState = {
  scrollX: number;
  scrollY: number;
  zoom: { value: number };
  width: number;
  height: number;
  activeTool?: { type?: string };
  selectedElementIds?: Record<string, boolean>;
};

type ExcalidrawAPI = {
  updateScene: (scene: {
    elements?: readonly unknown[];
    appState?: Record<string, unknown>;
    captureUpdate?: string;
  }) => void;
  getSceneElements: () => readonly ExcalidrawElement[];
  getSceneElementsIncludingDeleted: () => readonly ExcalidrawElement[];
  getAppState: () => ExcalidrawAppState;
  refresh: () => void;
  history: { clear: () => void };
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
  classroomChrome?: boolean;
  /** Teachers draw; students watch. */
  readOnly?: boolean;
  /** Deltas arriving from the classroom socket. */
  sceneUpdates: SceneDelta[];
  onConsumeUpdates: () => void;
  onSceneChange: (changed: unknown[], files: unknown[], pageId: string) => void;
  /**
   * A document to place on the board: a photo, or a PDF whose pages become pictures.
   *
   * The board does the converting rather than the screen around it, for two reasons. The phone
   * apps run this very page inside a WebView, so they get PDF support without a second
   * implementation; and "put this document on the board" is the board's job, which keeps the
   * classroom screens to arranging panes.
   *
   * Changing `key` places it; the same key is never placed twice, so a re-render cannot
   * duplicate a page.
   */
  insertDocument?: { key: string; dataUrl: string; kind: "image" | "pdf" } | null;
  /**
   * Accepted and never called. On the web the board is in this process, so a document cannot
   * be lost in transit to it — there is no transit. The prop exists so the two boards keep the
   * same signature and a caller that typechecks against one works against the other.
   */
  onDocumentLost?: () => void;
  /** Teacher only: publishes the part of the canvas they are looking at. */
  onViewportChange?: (view: BoardViewport) => void;
  /** Students only: the part of the canvas the teacher is looking at. */
  viewport?: BoardViewport | null;
  /** Teacher only: wipe the board for the whole class. */
  onClearAll?: () => void;
  /** Bumped by the server when the board is wiped at the start of a class. */
  clearedAt?: number;
  /** The teacher-owned page list. Older callers omit it and get the original single board. */
  pages?: BoardPage[];
  activePageId?: string;
  pageChangedAt?: number;
  onPageCommand?: (command: BoardPageCommand) => void;
  laser?: BoardLaserPoint | null;
  onLaser?: (point: BoardLaserPoint) => void;
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

const pageButtonStyle: React.CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  padding: "0 10px",
  border: "1px solid var(--default-border-color, silver)",
  borderRadius: 12,
  background: "white",
  color: "var(--text-primary-color, slategray)",
  fontSize: "medium",
  cursor: "pointer",
};

const pageMenuButtonStyle: React.CSSProperties = {
  minHeight: 44,
  padding: "9px 12px",
  border: "1px solid var(--default-border-color, silver)",
  borderRadius: 8,
  background: "white",
  color: "var(--color-primary, navy)",
  fontSize: "small",
  fontWeight: 700,
  textAlign: "left",
  cursor: "pointer",
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

const LaserIcon = () => (
  <svg {...iconProps} aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);

const UndoIcon = () => (
  <svg {...iconProps} aria-hidden="true">
    <path d="M9 7 4 12l5 5" />
    <path d="M5 12h8a6 6 0 0 1 6 6" />
  </svg>
);

const RedoIcon = () => (
  <svg {...iconProps} aria-hidden="true">
    <path d="m15 7 5 5-5 5" />
    <path d="M19 12h-8a6 6 0 0 0-6 6" />
  </svg>
);

function SmartBoard({
  classroomChrome = false,
  readOnly = false,
  sceneUpdates,
  onConsumeUpdates,
  onSceneChange,
  onViewportChange,
  viewport = null,
  insertDocument = null,
  onClearAll,
  clearedAt = 0,
  pages = [{ id: "page-1", title: "Page 1", template: "blank", locked: false }],
  activePageId = "page-1",
  pageChangedAt = 0,
  onPageCommand,
  laser = null,
  onLaser,
  theme = "light",
}: Props) {
  const [api, setApi] = useState<ExcalidrawAPI | null>(null);
  const colors = useColors();
  const [wideToolbar, setWideToolbar] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1440);
  useEffect(() => {
    let frame = 0;
    const resize = () => {
      setWideToolbar(window.innerWidth >= 1440);
      cancelAnimationFrame(frame);
      // Give the editor the updated container after a breakpoint/header change. Its responsive
      // toolbar must not retain the previous laptop width until the next pointer interaction.
      frame = requestAnimationFrame(() => api?.refresh());
    };
    resize();
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", resize); };
  }, [api, classroomChrome]);
  const boardRootRef = useRef<HTMLDivElement | null>(null);
  const [historyState, setHistoryState] = useState({ undo: false, redo: false });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionLocked, setSelectionLocked] = useState(false);
  const historyTransitionUntilRef = useRef(0);
  const [boardDialog, setBoardDialog] = useState<
    | { kind: "rename"; value: string }
    | { kind: "delete"; pageTitle: string }
    | { kind: "clear" }
    | null
  >(null);
  /** Whether Excalidraw's shape properties panel is currently allowed on screen. */
  const [showProps, setShowProps] = useState(false);
  /** Teacher ink settings stay visible even while Excalidraw's larger properties panel is hidden. */
  const [inkColor, setInkColor] = useState<string>(BOARD_INK_COLORS[0][1]);
  const [inkThickness, setInkThickness] = useState<1 | 2 | 4>(2);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [mediaElements, setMediaElements] = useState<ExcalidrawElement[]>([]);
  const pdfGroups = new Map<string, string[]>();
  for (const element of mediaElements) {
    const documentId = (element.customData as { fadkoDocumentId?: string } | undefined)?.fadkoDocumentId;
    if (documentId) pdfGroups.set(documentId, [...(pdfGroups.get(documentId) ?? []), element.id]);
  }
  const lastFocusId = useRef<number | null>(null);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [pageSidebarOpen, setPageSidebarOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  useEffect(() => { if (pageMenuOpen || materialsOpen) setZoomMenuOpen(false); }, [pageMenuOpen, materialsOpen]);
  const [laserMode, setLaserMode] = useState(false);
  const lastLaserSent = useRef(0);
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0];
  const pageLocked = Boolean(activePage?.locked);
  const boardReadOnly = readOnly || pageLocked;
  /** Locking protects page content; it must never take the teacher's Unlock control away. */
  const canManagePages = !readOnly && Boolean(onPageCommand);
  const activePageIndex = Math.max(0, pages.findIndex((page) => page.id === activePage?.id));

  function zoomBoard(factor: number) {
    if (!api || readOnly) return;
    const state = api.getAppState();
    const previous = state.zoom.value;
    const zoom = clamp(previous * factor, MIN_ZOOM, MAX_ZOOM);
    // Zoom about the centre, not the top-left corner; students follow that same centre.
    api.updateScene({ appState: { zoom: { value: zoom },
      scrollX: state.scrollX + state.width / (2 * zoom) - state.width / (2 * previous),
      scrollY: state.scrollY + state.height / (2 * zoom) - state.height / (2 * previous) } });
    scheduleViewportPublish();
  }

  function fitCurrentSheet() {
    if (!api) return;
    const state = api.getAppState();
    const cx = -state.scrollX + state.width / (2 * state.zoom.value);
    const cy = -state.scrollY + state.height / (2 * state.zoom.value);
    const pictures = api.getSceneElements().filter((element) => element.type === "image" && !element.isDeleted);
    const distance = (element: ExcalidrawElement) => Math.hypot(Number(element.x) + Number(element.width) / 2 - cx, Number(element.y) + Number(element.height) / 2 - cy);
    const nearest = pictures.sort((a, b) => distance(a) - distance(b))[0];
    api.scrollToContent(nearest ? [nearest] : api.getSceneElements(), { fitToContent: true, animate: false, maxZoom: 1 });
    scheduleViewportPublish();
  }

  /** An explicit document list is easier to use than a browser right-click menu. */
  function changeMediaObjects(ids: string[], operation: "remove" | "lock" | "unlock") {
    if (!api || boardReadOnly || ids.length === 0) return;
    const targets = new Set(ids);
    // Explicit removal is not an eraser gesture, even if that tool was selected before Files.
    if (operation === "remove") for (const id of ids) visibleBeforeErase.current.delete(id);
    const now = Date.now();
    const next = api.getSceneElementsIncludingDeleted().map((element: ExcalidrawElement) =>
      targets.has(element.id) && !element.isDeleted
        ? { ...element, ...(operation === "remove" ? { isDeleted: true } : { locked: operation === "lock" }),
            version: Math.max(1, Number(element.version) || 1) + 1,
            versionNonce: Math.floor(Math.random() * 1_000_000_000), updated: now }
        : element,
    );
    api.updateScene({ elements: next,
      appState: { selectedElementIds: {}, activeTool: { ...api.getAppState().activeTool, type: "selection" } },
      captureUpdate: "IMMEDIATELY" });
    setMediaElements(next.filter((element: ExcalidrawElement) => element.type === "image" && !element.isDeleted));
    setHistoryState({ undo: true, redo: false });
    api.setToast({ message: operation === "remove" ? "Document removed from this board page" : operation === "lock" ? "Document locked" : "Document unlocked", duration: 2500 });
    setTimeout(() => flushRef.current(), 0);
  }

  const handleLaserMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!laserMode || boardReadOnly || !onLaser) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    const now = Date.now();
    if (now - lastLaserSent.current < LASER_THROTTLE_MS) return;
    lastLaserSent.current = now;
    onLaser(normalizeLaserPoint((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height));
  }, [boardReadOnly, laserMode, onLaser]);

  const stopLaser = useCallback(() => {
    if (!laserMode) return;
    setLaserMode(false);
    onLaser?.({ x: 0, y: 0, active: false });
  }, [laserMode, onLaser]);

  const toggleLaser = useCallback(() => {
    setLaserMode((enabled) => {
      if (enabled) onLaser?.({ x: 0, y: 0, active: false });
      return !enabled;
    });
  }, [onLaser]);

  const renamePage = useCallback(() => {
    if (!canManagePages || !activePage) return;
    setBoardDialog({ kind: "rename", value: activePage.title });
  }, [activePage, canManagePages, onPageCommand]);

  const deletePage = useCallback(() => {
    if (!canManagePages || !activePage || pages.length <= 1) return;
    setBoardDialog({ kind: "delete", pageTitle: activePage.title });
  }, [activePage, canManagePages, pages.length]);

  const runHistoryShortcut = useCallback((redo: boolean) => {
    if (!api || typeof window === "undefined") return;
    historyTransitionUntilRef.current = Date.now() + 250;
    const editor = boardRootRef.current?.querySelector<HTMLElement>(".excalidraw");
    if (editor) {
      const isApple = /Mac|iPhone|iPad|iPod/i.test(window.navigator.platform);
      // Use the editor's own keyboard action. Its handler is on the editor (or document when
      // global shortcuts are enabled), never window. Clicking our external Files panel must
      // not leave Undo dependent on whether a previous drawing gesture installed a listener.
      editor.focus({ preventScroll: true });
      editor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "z",
        code: "KeyZ",
        ctrlKey: !isApple,
        metaKey: isApple,
        shiftKey: redo,
        bubbles: true,
        cancelable: true,
      }));
    }
    setHistoryState({
      undo: redo ? true : api.getSceneElementsIncludingDeleted().length > 1,
      redo: !redo,
    });
  }, [api]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const afterKeyboardHistory = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || (!event.ctrlKey && !event.metaKey)) return;
      // Excalidraw has already applied the shortcut by key-up. Track the resulting availability
      // ourselves: its responsive DOM keeps hidden history buttons mounted whose `disabled`
      // attributes do not reliably represent the active editor.
      window.setTimeout(() => {
        setHistoryState({
          undo: event.shiftKey ? true : Boolean(api?.getSceneElements().length),
          redo: !event.shiftKey,
        });
      }, 0);
    };
    window.addEventListener("keyup", afterKeyboardHistory);
    return () => window.removeEventListener("keyup", afterKeyboardHistory);
  }, [api]);

  const historyControls = !boardReadOnly ? (
    <div
      className="sikshya-board__history"
      role="group"
      aria-label="Whiteboard history"
      style={{
        position: "absolute",
        right: 12,
        top: "calc(env(safe-area-inset-top, 0px) + 128px)",
        zIndex: 8,
        display: "flex",
        gap: 6,
        padding: 5,
        border: "1px solid rgba(15,23,42,0.12)",
        borderRadius: 16,
        background: "rgba(255,255,255,0.94)",
        boxShadow: "0 10px 28px rgba(15,23,42,0.16)",
        backdropFilter: "blur(16px)",
      }}
    >
      <button
        type="button"
        aria-label="Undo last board change"
        title="Undo"
        disabled={!historyState.undo}
        onClick={() => runHistoryShortcut(false)}
        style={{ ...pageButtonStyle, display: "grid", placeItems: "center" }}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        aria-label="Redo board change"
        title="Redo"
        disabled={!historyState.redo}
        onClick={() => runHistoryShortcut(true)}
        style={{ ...pageButtonStyle, display: "grid", placeItems: "center" }}
      >
        <RedoIcon />
      </button>
      <button type="button" aria-label="Choose ink colour and thickness" title="Ink settings"
        aria-expanded={colorMenuOpen} onClick={() => setColorMenuOpen((open) => !open)}
        style={{ ...pageButtonStyle, display: "grid", placeItems: "center", gap: 2 }}>
        <span aria-hidden="true" style={{ width: 19, height: 19, borderRadius: "50%", background: inkColor, border: "2px solid white", boxShadow: "0 0 0 1px rgba(15,23,42,0.25)" }} />
        <span aria-hidden="true" style={{ width: 19, height: inkThickness, minHeight: 1, borderRadius: 99, background: inkColor }} />
      </button>
      {colorMenuOpen ? (
        <div role="group" aria-label="Ink settings" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 244, display: "grid", gap: 12, padding: 12, borderRadius: 16, border: "1px solid rgba(15,23,42,0.12)", background: "white", boxShadow: "0 10px 28px rgba(15,23,42,0.16)" }}>
          <div style={{ display: "grid", gap: 7 }}>
            <strong style={{ color: colors.foreground, fontFamily: "system-ui, sans-serif", fontSize: "small" }}>Ink colour</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {BOARD_INK_COLORS.map(([name, value]) => (
                <button key={value} type="button" aria-label={`${name} writing colour`} aria-pressed={inkColor === value}
                  onClick={() => { api?.updateScene({ appState: { currentItemStrokeColor: value } }); setInkColor(value); }}
                  style={{ minWidth: 44, height: 44, borderRadius: 12, border: inkColor === value ? `3px solid ${colors.foreground}` : "2px solid white", background: value, boxShadow: "0 0 0 1px rgba(15,23,42,0.2)", cursor: "pointer" }} />
              ))}
            </div>
          </div>
          <label style={{ display: "grid", gap: 8, color: colors.foreground, fontFamily: "system-ui, sans-serif", fontSize: "small", fontWeight: 700 }}>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span>Ink thickness</span>
              <span style={{ color: colors.mutedForeground, fontWeight: 600 }}>{inkThickness === 1 ? "Thin" : inkThickness === 2 ? "Medium" : "Bold"}</span>
            </span>
            <input
              aria-label="Ink thickness"
              aria-valuetext={inkThickness === 1 ? "Thin" : inkThickness === 2 ? "Medium" : "Bold"}
              type="range"
              min={0}
              max={2}
              step={1}
              value={inkThickness === 1 ? 0 : inkThickness === 2 ? 1 : 2}
              onChange={(event) => {
                const width = ([1, 2, 4] as const)[Number(event.currentTarget.value)] ?? 2;
                api?.updateScene({ appState: { currentItemStrokeWidth: width } });
                setInkThickness(width);
              }}
              style={{ width: "100%", accentColor: inkColor, cursor: "pointer" }}
            />
            <span aria-hidden="true" style={{ display: "block", width: "100%", height: inkThickness, minHeight: 1, borderRadius: 99, background: inkColor }} />
          </label>
        </div>
      ) : null}
    </div>
  ) : null;

  const pageNavigator = (
    <div
      className="sikshya-board__pages"
      style={{
        position: "absolute",
        left: 12,
        bottom: 12,
        zIndex: 8,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: 6,
        border: "1px solid rgba(15,23,42,0.12)",
        maxWidth: "calc(100% - 24px)",
        borderRadius: 18,
        background: "rgba(255,255,255,0.94)",
        boxShadow: "0 12px 34px rgba(15,23,42,0.18)",
        backdropFilter: "blur(16px)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {canManagePages ? (
        <>
          <button type="button" aria-label="Previous board page" title="Previous page" disabled={activePageIndex <= 0} onClick={() => onPageCommand?.({ op: "select", pageId: pages[Math.max(0, activePageIndex - 1)].id })} style={pageButtonStyle}>
            ‹
          </button>
          <button className="sikshya-board__page-label" type="button" aria-label="Open board pages" onClick={() => setPageMenuOpen((open) => !open)} style={{ ...pageButtonStyle, minWidth: 118, fontSize: "small", fontWeight: 700, color: "var(--color-primary, navy)" }}>
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activePage?.title === `Page ${activePageIndex + 1}` ? `Page ${activePageIndex + 1} of ${pages.length}` : activePage?.title ?? "Board page"}</span>
            {activePage?.title !== `Page ${activePageIndex + 1}` ? <span style={{ display: "block", color: "var(--text-muted-color, slategray)", fontWeight: 500, fontSize: "x-small" }}>Page {activePageIndex + 1} of {pages.length}</span> : null}
          </button>
          <button type="button" aria-label="Next board page" title="Next page" disabled={activePageIndex >= pages.length - 1} onClick={() => onPageCommand?.({ op: "select", pageId: pages[Math.min(pages.length - 1, activePageIndex + 1)].id })} style={pageButtonStyle}>
            ›
          </button>
        </>
      ) : null}
      {onPageCommand ? (
        <button className="sikshya-board__thumb-toggle" type="button" aria-label={mediaElements.length ? "Manage teaching materials" : "Show board page thumbnails"} title={mediaElements.length ? "Materials: unlock or remove" : "Page thumbnails"} aria-pressed={mediaElements.length ? materialsOpen : pageSidebarOpen} onClick={() => mediaElements.length ? setMaterialsOpen((open) => !open) : setPageSidebarOpen((open) => !open)} style={{ ...pageButtonStyle, background: pageSidebarOpen || materialsOpen ? "var(--color-primary-light, aliceblue)" : "white", color: "var(--color-primary, navy)" }}>
          {mediaElements.length ? <span style={{ fontSize: "small", fontWeight: 600 }}>Files</span> : "▦"}
        </button>
      ) : null}
      {canManagePages && onPageCommand ? (
        <button type="button" aria-label="Add board page" title="Add page" onClick={() => onPageCommand({ op: "add", template: "blank" })} style={{ ...pageButtonStyle, background: "var(--color-primary, navy)", color: "white", borderColor: "var(--color-primary, navy)", fontSize: "large" }}>
          +
        </button>
      ) : null}
      {!readOnly ? <button type="button" aria-label="Whiteboard zoom" aria-expanded={zoomMenuOpen}
        onClick={() => { setZoomMenuOpen((open) => !open); setPageMenuOpen(false); setMaterialsOpen(false); }}
        style={{ ...pageButtonStyle, minWidth: 56, color: colors.primary, fontSize: "small", fontVariantNumeric: "tabular-nums" }}>{zoomPercent}%</button> : null}
      {zoomMenuOpen && !readOnly ? <div role="group" aria-label="Whiteboard zoom controls"
        style={{ position: "absolute", left: 0, bottom: "calc(100% + 8px)", width: 250, padding: 12, display: "grid", gap: 10, border: `1px solid ${colors.border}`, borderRadius: 16, background: colors.card, boxShadow: "0 12px 32px rgba(15,23,42,0.18)" }}>
        <strong style={{ color: colors.foreground, fontSize: "small" }}>Zoom for everyone</strong>
        <span style={{ color: colors.mutedForeground, fontSize: "small", lineHeight: 1.4 }}>Students follow your view, fitted to their screen.</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" aria-label="Zoom out on whiteboard" disabled={zoomPercent <= 10} onClick={() => zoomBoard(0.8)} style={{ ...pageMenuButtonStyle, flex: 1 }}>−</button>
          <button type="button" aria-label="Reset whiteboard zoom to 100 percent" onClick={() => zoomBoard(100 / zoomPercent)} style={{ ...pageMenuButtonStyle, flex: 2 }}>100%</button>
          <button type="button" aria-label="Zoom in on whiteboard" disabled={zoomPercent >= 1000} onClick={() => zoomBoard(1.25)} style={{ ...pageMenuButtonStyle, flex: 1 }}>+</button>
        </div>
        <button type="button" onClick={fitCurrentSheet} style={pageMenuButtonStyle}>Fit current sheet</button>
        <button type="button" aria-label="Close whiteboard zoom" onClick={() => setZoomMenuOpen(false)} style={pageMenuButtonStyle}>Done</button>
      </div> : null}
      {(!zoomMenuOpen && (pageMenuOpen || materialsOpen)) ? (
        <div style={{ position: "absolute", left: 0, bottom: "calc(100% + 8px)", width: 260, maxHeight: "min(70vh, 520px)", overflowY: "auto", padding: 10, display: "grid", gap: 8, border: "1px solid rgba(15,23,42,0.12)", borderRadius: 14, background: "rgba(255,255,255,0.98)", boxShadow: "0 12px 32px rgba(15,23,42,0.18)" }}>
          <div style={{ fontSize: "small", color: "var(--text-primary-color, black)", fontWeight: 700 }}>{materialsOpen ? "Teaching materials" : "Board pages"}</div>
          {materialsOpen ? <span style={{ fontSize: "small", lineHeight: 1.5, color: "var(--text-muted-color, slategray)" }}>
            Materials on {activePage?.title ?? "this page"}. Each PDF sheet is a separate object here. New board pages stay blank.
          </span> : null}
          {!materialsOpen && pages.map((page, index) => (
            <button key={page.id} type="button" onClick={() => { onPageCommand?.({ op: "select", pageId: page.id }); setPageMenuOpen(false); }} style={{ ...pageMenuButtonStyle, background: page.id === activePage?.id ? "var(--color-primary-light, aliceblue)" : "transparent", color: page.id === activePage?.id ? "var(--color-primary, navy)" : "var(--text-primary-color, black)" }}>
              <span>{index + 1}. {page.title}</span><span style={{ color: "var(--text-muted-color, slategray)" }}>{page.locked ? "Locked" : TEMPLATE_LABELS[page.template]}</span>
            </button>
          ))}
          {!materialsOpen && canManagePages && activePage ? (
            <>
              <label style={{ display: "grid", gap: 4, color: "var(--text-muted-color, slategray)", fontSize: "x-small", fontWeight: 700 }}>
                Page template
                <select value={activePage.template} onChange={(event) => onPageCommand?.({ op: "template", pageId: activePage.id, template: event.target.value as BoardTemplate })} style={{ minHeight: 34, border: "1px solid var(--default-border-color, silver)", borderRadius: 8, padding: "0 8px", background: "white", color: "var(--text-primary-color, black)" }}>
                  {Object.entries(TEMPLATE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => onPageCommand?.({ op: "duplicate", pageId: activePage.id })} style={pageMenuButtonStyle}>Duplicate</button>
                <button type="button" onClick={renamePage} style={pageMenuButtonStyle}>Rename</button>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" disabled={activePageIndex <= 0} onClick={() => onPageCommand?.({ op: "reorder", pageId: activePage.id, toIndex: activePageIndex - 1 })} style={{ ...pageMenuButtonStyle, flex: 1 }}>Move up</button>
                <button type="button" disabled={activePageIndex >= pages.length - 1} onClick={() => onPageCommand?.({ op: "reorder", pageId: activePage.id, toIndex: activePageIndex + 1 })} style={{ ...pageMenuButtonStyle, flex: 1 }}>Move down</button>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => onPageCommand?.({ op: "lock", pageId: activePage.id, locked: !activePage.locked })} style={pageMenuButtonStyle}>{activePage.locked ? "Unlock" : "Lock"}</button>
                <button type="button" disabled={pages.length <= 1} onClick={deletePage} style={{ ...pageMenuButtonStyle, color: "var(--color-danger, firebrick)" }}>Delete</button>
              </div>
            </>
          ) : null}
          <button type="button" aria-label="Close board page menu" onClick={() => { setPageMenuOpen(false); setMaterialsOpen(false); }} style={pageMenuButtonStyle}>Done</button>
          {canManagePages && mediaElements.length > 0 ? (
            <div style={{ display: "grid", gap: 8, paddingTop: 8, borderTop: "1px solid rgba(15,23,42,0.12)" }}>
              {!materialsOpen && <strong style={{ color: "var(--text-primary-color, black)", fontSize: "small" }}>Pictures and PDF pages on this board page</strong>}
              {pageLocked ? <button type="button" onClick={() => onPageCommand?.({ op: "lock", pageId: activePageId, locked: false })} style={pageMenuButtonStyle}>Unlock board page to edit materials</button> : null}
              {[...pdfGroups.entries()].map(([documentId, ids], index) => (
                <div key={documentId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 7, borderRadius: 9, background: "rgba(29,78,216,0.06)" }}>
                  <span style={{ color: "var(--text-primary-color, black)", fontSize: "small" }}>PDF {index + 1} · {ids.length} pages</span>
                  <button type="button" disabled={pageLocked} aria-label={`Remove all pages of PDF ${index + 1}`} onClick={() => changeMediaObjects(ids, "remove")} style={{ ...pageMenuButtonStyle, color: "var(--color-danger, firebrick)" }}>Remove all</button>
                </div>
              ))}
              {mediaElements.map((element, index) => {
                const data = element.customData as { fadkoPage?: number; fadkoTotal?: number; fadkoDocumentId?: string } | undefined;
                const label = data?.fadkoPage ? `PDF page ${data.fadkoPage} of ${data.fadkoTotal ?? "?"}` : `Picture ${index + 1}`;
                return <div key={element.id} style={{ display: "grid", gap: 5, padding: 7, borderRadius: 9, background: "rgba(15,23,42,0.04)" }}>
                  <span style={{ color: "var(--text-primary-color, black)", fontSize: "small" }}>{label}{element.locked ? " · Locked" : ""}</span>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <button type="button" aria-label={`Find ${label} on board`} onClick={() => api?.scrollToContent([element], { fitToContent: true, animate: false, maxZoom: 1 })} style={pageMenuButtonStyle}>Locate</button>
                    <button type="button" disabled={pageLocked} aria-label={`${element.locked ? "Unlock" : "Lock"} ${label}`} onClick={() => changeMediaObjects([element.id], element.locked ? "unlock" : "lock")} style={pageMenuButtonStyle}>{element.locked ? "Unlock" : "Lock"}</button>
                    <button type="button" disabled={pageLocked} aria-label={`Remove ${label}`} onClick={() => changeMediaObjects([element.id], "remove")} style={{ ...pageMenuButtonStyle, color: "var(--color-danger, firebrick)" }}>{data?.fadkoPage ? "Remove sheet" : "Remove picture"}</button>
                  </div>
                </div>;
              })}
            </div>
          ) : null}
          {materialsOpen && mediaElements.length === 0 ? <span style={{ fontSize: "small" }}>No pictures or PDF sheets on this board page.</span> : null}
        </div>
      ) : null}
      {pageSidebarOpen && onPageCommand ? (
        <div role="navigation" aria-label="Whiteboard page thumbnails" style={{ position: "absolute", left: 12, bottom: 60, zIndex: 8, width: 250, maxHeight: "min(60vh, 440px)", overflowY: "auto", display: "grid", gap: 8, padding: 10, border: "1px solid rgba(15,23,42,0.12)", borderRadius: 14, background: "rgba(255,255,255,0.98)", boxShadow: "0 12px 32px rgba(15,23,42,0.18)", backdropFilter: "blur(16px)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: "x-small", color: "var(--text-muted-color, slategray)", fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase" }}>Pages</div>
            <button type="button" aria-label="Close page thumbnails" onClick={() => setPageSidebarOpen(false)} style={{ ...pageButtonStyle, minWidth: 28, minHeight: 28, padding: 0 }}>×</button>
          </div>
          {pages.map((page, index) => (
            <button key={page.id} type="button" onClick={() => { onPageCommand({ op: "select", pageId: page.id }); setPageSidebarOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 52, padding: 6, border: "1px solid transparent", borderRadius: 10, background: page.id === activePage?.id ? "var(--color-primary-light, aliceblue)" : "transparent", color: "var(--text-primary-color, black)", textAlign: "left", cursor: "pointer" }}>
              <span aria-hidden="true" style={pageThumbnailStyle(page.template, page.id === activePage?.id)} />
              <span style={{ display: "grid", gap: 2, minWidth: 0 }}><strong style={{ fontSize: "small", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{index + 1}. {page.title}</strong><span style={{ color: "var(--text-muted-color, slategray)", fontSize: "x-small" }}>{page.locked ? "Locked" : TEMPLATE_LABELS[page.template]}</span></span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  /**
   * The version of each element as last broadcast.
   *
   * This is what makes delta sync possible: an element is only worth sending if its version has
   * moved since we last sent it. Without it, every change would re-broadcast the whole board.
   */
  const sentVersions = useRef<Map<string, number>>(new Map());
  /** Pictures already put on the wire. They are large and never change once created. */
  const sentFiles = useRef<Set<string>>(new Set());
  /**
   * Pictures being brought down to a size the class can receive, and the results.
   *
   * Excalidraw's own image button puts the picked file straight into the scene, untouched.
   * A phone photo is routinely 2-5 MB, and measured against the real server that means the
   * student gets an empty frame at 2 MB and the teacher's board connection is closed
   * outright at 3 MB. So an oversized picture is re-encoded before it goes on the wire, and
   * its element is held back until it is ready — an image element without its picture is
   * exactly the empty frame we are trying to avoid.
   */
  const shrinking = useRef<Set<string>>(new Set());
  const shareable = useRef<Map<string, BinaryFile>>(new Map());
  /** Pictures that could not be made small enough. Reported once, then never retried. */
  const unshareable = useRef<Set<string>>(new Set());
  /**
   * Always points at the current `flush`.
   *
   * The re-encode above finishes after `flush` has already returned, and it is declared
   * before it, so it cannot call it directly without capturing a stale copy.
   */
  const flushRef = useRef<() => void>(() => {});
  const insertedImages = useRef<Set<string>>(new Set());
  const pendingSync = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingView = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingApply = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentView = useRef<BoardViewport | null>(null);
  /** The viewport this board was last moved to on the teacher's behalf. */
  const appliedView = useRef<{ scrollX: number; scrollY: number; zoom: number } | null>(null);
  /** The page-change counter for which the local Excalidraw scene has already been reset. */
  const appliedPageChange = useRef(0);
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
  /** The last intact objects, used to keep an eraser stroke from cutting holes in lesson pages. */
  const visibleBeforeErase = useRef<Map<string, ExcalidrawElement>>(new Map());
  /** `updateScene` fires `onChange`; this prevents a protected-object restore from recursing. */
  const restoringProtected = useRef(false);

  /**
   * The version of a picture that may go on the wire, or null while one is being made.
   *
   * Kicks off the re-encode the first time it is asked about a picture that is too big, and
   * schedules another sync pass for when it lands.
   */
  const readyToShare = useCallback(
    (fileId: string, source: BinaryFile): BinaryFile | null => {
      const already = shareable.current.get(fileId);
      if (already) return already;

      const dataUrl = typeof source.dataURL === "string" ? source.dataURL : "";
      if (!dataUrl) return null;
      if (isShareableSize(dataUrl)) return source;

      if (!shrinking.current.has(fileId)) {
        shrinking.current.add(fileId);
        void shrinkForSharing(dataUrl)
          .then((smaller) => {
            shareable.current.set(fileId, { ...source, mimeType: "image/jpeg", dataURL: smaller });
          })
          .catch(() => {
            // Beyond saving. Say so once, rather than leaving the teacher believing the class
            // can see something they cannot.
            unshareable.current.add(fileId);
            api?.setToast({
              message: "That picture is too large to share with the class. Try a smaller one.",
              duration: 6000,
            });
          })
          .finally(() => {
            shrinking.current.delete(fileId);
            // The element is still held back waiting on this, and Excalidraw will not fire
            // another change on its own — nothing on the board moved. So ask for one more
            // pass explicitly, or the picture would sit here until the teacher next drew.
            if (!pendingSync.current) pendingSync.current = setTimeout(() => flushRef.current(), SYNC_INTERVAL_MS);
          });
      }
      return null;
    },
    [api],
  );

  // --- outgoing: what changed since last time ---
  const flush = useCallback(() => {
    pendingSync.current = null;
    if (!api || boardReadOnly) return;

    // Deleted elements included, deliberately: erasing is an edit, and a board that only ever
    // reports additions leaves every student looking at work the teacher rubbed out.
    const elements = api.getSceneElementsIncludingDeleted();
    const available = api.getFiles();
    const changed: unknown[] = [];
    // An image element is a frame and a reference; the picture itself lives in a separate map
    // and has to travel with it, once. Without this a student gets the frame and no picture,
    // and resizing it on the teacher's board just gives them a bigger empty frame.
    const files: unknown[] = [];

    for (const el of elements) {
      const last = sentVersions.current.get(el.id);
      if (last === el.version) continue;

      const fileId = typeof el.fileId === "string" ? el.fileId : null;
      if (fileId && !sentFiles.current.has(fileId)) {
        /**
         * A picture that could not be made small enough holds its element back for good.
         *
         * This used to read `&& !unshareable.has(fileId)`, which skipped the whole guard for
         * exactly the pictures that could not be sent — so the element went out alone and every
         * student got a grey placeholder where the page should be, for the rest of the lesson,
         * with nothing to tell them or the teacher that the two boards no longer matched. The
         * teacher saw their own copy, which renders from local memory and always looks right.
         * Sending nothing is the honest outcome; the toast beside `unshareable` says why.
         */
        if (unshareable.current.has(fileId)) continue;

        const source = available[fileId];
        // The bytes are not in the scene yet; leave the element unsent and pick it up on a
        // later pass rather than sending a frame with nothing behind it.
        if (!source) continue;

        const ready = readyToShare(fileId, source);
        // Still being re-encoded. Holding the element back is the point: the student would
        // otherwise render an empty frame until the picture caught up.
        if (!ready) continue;

        sentFiles.current.add(fileId);
        files.push(ready);
      }

      sentVersions.current.set(el.id, el.version);
      changed.push(el);
    }

    for (const packet of boardScenePackets(changed, files, activePageId)) {
      onSceneChange(packet.elements, packet.files, packet.pageId);
    }
  }, [activePageId, api, boardReadOnly, onSceneChange, readyToShare]);
  flushRef.current = flush;

  // --- outgoing: where the teacher is looking ---
  const publishViewport = useCallback((forceFocus = false) => {
    pendingView.current = null;
    if (!api || boardReadOnly || !onViewportChange) return;

    const state = api.getAppState();
    const zoom = state.zoom?.value ?? 1;
    if (!(zoom > 0) || !(state.width > 0) || !(state.height > 0)) return;

    const view: BoardViewport = {
      minX: -state.scrollX,
      minY: -state.scrollY,
      maxX: -state.scrollX + state.width / zoom,
      maxY: -state.scrollY + state.height / zoom,
      ...(forceFocus ? { focusId: Date.now() } : {}),
    };
    if (!forceFocus && sameView(sentView.current, view)) return;
    sentView.current = view;
    onViewportChange(view);
  }, [api, boardReadOnly, onViewportChange]);

  const scheduleViewportPublish = useCallback(() => {
    if (boardReadOnly || pendingView.current) return;
    pendingView.current = setTimeout(publishViewport, VIEWPORT_SYNC_MS);
  }, [boardReadOnly, publishViewport]);

  const handleChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState?: ExcalidrawAppState,
    ) => {
      if (appState?.zoom?.value) setZoomPercent(Math.round(appState.zoom.value * 100));
      const nextSelected = Object.entries(appState?.selectedElementIds ?? {})
        .filter(([, selected]) => selected)
        .map(([id]) => id);
      setSelectedIds((current) =>
        current.length === nextSelected.length && current.every((id, index) => id === nextSelected[index])
          ? current
          : nextSelected,
      );
      setSelectionLocked(elements.some((element) => nextSelected.includes(element.id) && element.locked === true));
      if (boardReadOnly || applyingRemote.current || restoringProtected.current) return;

      // `onChange` may omit erased elements; the inclusive scene is the only reliable record of
      // which object the eraser just marked deleted.
      let scene = [...(api?.getSceneElementsIncludingDeleted() ?? elements)];
      const images = scene.filter((element) => element.type === "image" && !element.isDeleted);
      setMediaElements((current) => current.length === images.length && current.every((element, index) => element.id === images[index].id && element.version === images[index].version) ? current : images);
      if (appState?.activeTool?.type === "eraser") {
        const protectedScene = protectBoardElementsFromEraser(
          scene,
          visibleBeforeErase.current,
        );
        scene = protectedScene.elements;
        if (protectedScene.protectedCount > 0 && api) {
          restoringProtected.current = true;
          api.updateScene({ elements: scene, captureUpdate: "IMMEDIATELY" });
          api.setToast({
            message: "Eraser removes writing only. Select a picture or shape and press Delete to remove it.",
            duration: 4200,
          });
          setTimeout(() => { restoringProtected.current = false; }, 0);
        }
      }
      rememberVisibleBoardElements(visibleBeforeErase.current, scene);
      if (Date.now() >= historyTransitionUntilRef.current) {
        setHistoryState((current) => {
          const next = { undo: scene.length > 0, redo: false };
          return current.undo === next.undo && current.redo === next.redo ? current : next;
        });
      }
      // Drawing at the edge of the screen scrolls the canvas, so the view is worth re-checking
      // on any change; `publishViewport` drops it again if the rectangle has not moved.
      scheduleViewportPublish();
      if (pendingSync.current) return;
      pendingSync.current = setTimeout(flush, SYNC_INTERVAL_MS);
    },
    [api, boardReadOnly, flush, scheduleViewportPublish],
  );

  // Publish the opening view as soon as the board is up, so a student arriving later is put
  // where the teacher already is rather than at an arbitrary corner of an infinite canvas.
  useEffect(() => {
    if (!api || boardReadOnly) return;
    sentView.current = null;
    scheduleViewportPublish();
  }, [activePageId, api, boardReadOnly, scheduleViewportPublish]);

  // Browser chrome/orientation can change the canvas independently of a drawing gesture.
  // Publish the measured editor (not the stale pre-resize app state) even if the teacher is idle.
  useEffect(() => {
    const editor = boardRootRef.current?.querySelector(".sikshya-board__editor");
    if (!api || readOnly || !editor) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { api.refresh(); scheduleViewportPublish(); }, 120);
    };
    const observer = new ResizeObserver(refresh);
    observer.observe(editor);
    window.visualViewport?.addEventListener("resize", refresh);
    return () => { clearTimeout(timer); observer.disconnect(); window.visualViewport?.removeEventListener("resize", refresh); };
  }, [api, readOnly, scheduleViewportPublish]);

  useEffect(() => {
    return () => {
      if (pendingSync.current) clearTimeout(pendingSync.current);
      if (pendingView.current) clearTimeout(pendingView.current);
      if (pendingApply.current) clearTimeout(pendingApply.current);
    };
  }, []);

  // --- incoming: always follow the teacher's view ---
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
    if (!api || !readOnly || !viewport) return;
    if (viewport.focusId !== undefined && viewport.focusId !== lastFocusId.current) {
      lastFocusId.current = viewport.focusId;
      applyViewport(viewport);
      api.setToast({ message: "Your teacher brought everyone back to this view", duration: 2400 });
      return;
    }
    applyViewport(viewport);
  }, [api, readOnly, viewport, applyViewport]);

  // A phone can rotate while the teacher is still drawing. Refit the latest teacher view even
  // when no new viewport message arrives, because students cannot pan the read-only board.
  useEffect(() => {
    if (!api || !readOnly || !viewport || !boardRootRef.current) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refit = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => applyViewport(viewport), 120);
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(refit) : null;
    observer?.observe(boardRootRef.current);
    window.addEventListener("resize", refit);
    return () => {
      if (pending) clearTimeout(pending);
      observer?.disconnect();
      window.removeEventListener("resize", refit);
    };
  }, [api, readOnly, viewport, applyViewport]);

  const handleScrollChange = useCallback(
    (_scrollX: number, _scrollY: number, _zoom: { value: number }) => {
      if (!readOnly) {
        scheduleViewportPublish();
      }
    },
    [readOnly, scheduleViewportPublish],
  );

  // --- incoming: merge deltas into the live scene ---
  useEffect(() => {
    if (!api) return;

    /**
     * A page list and its full scene are two WebSocket messages. They can be batched by React,
     * or the full scene can arrive one tick later. Reset exactly once per page counter, before
     * considering the matching deltas, and ignore anything that belongs to the previous page.
     * This prevents a fast page switch from either leaking old ink or erasing the new scene.
     */
    const pageChanged = pageChangedAt !== 0 && appliedPageChange.current !== pageChangedAt;
    if (pageChanged) {
      appliedPageChange.current = pageChangedAt;
      sentVersions.current.clear();
      sentFiles.current.clear();
      // An upload key belongs to the whole classroom, not the active page. Clearing it here
      // reinserted the same PDF every time the teacher added or selected a page.
      visibleBeforeErase.current.clear();
      setMediaElements([]);
      setHistoryState({ undo: false, redo: false });
      fitted.current = false;
      applyingRemote.current = true;
      api.updateScene({ elements: [], captureUpdate: "NEVER" });
      api.history.clear();
      setTimeout(() => { applyingRemote.current = false; }, 0);
    }

    if (sceneUpdates.length === 0) return;
    const matchingUpdates = sceneUpdates.filter((delta) => !delta.pageId || delta.pageId === activePageId);
    // A full state follows every server-owned page switch, so deltas naming another page are
    // stale by definition. Do not leave them queued to appear later on the wrong visit.
    onConsumeUpdates();
    if (matchingUpdates.length === 0) return;

    // Deleted elements are kept in the map rather than dropped. They are the record that
    // something was erased: without them a late-arriving stale update would put it back.
    const current = new Map<string, ExcalidrawElement>();
    for (const el of api.getSceneElementsIncludingDeleted()) current.set(el.id, el);

    // Pictures first. Excalidraw renders an image element the moment it appears, so handing it
    // the element before the bytes shows an empty frame that only corrects itself on the next
    // change — and there may not be one.
    const incomingFiles: BinaryFile[] = [];
    for (const delta of matchingUpdates) {
      for (const raw of delta.files ?? []) {
        const file = raw as BinaryFile;
        if (!file || typeof file.id !== "string" || typeof file.dataURL !== "string") continue;
        sentFiles.current.add(file.id);
        incomingFiles.push(file);
      }
    }
    let touched = false;
    for (const delta of matchingUpdates) {
      // A catch-up is authoritative, including deletions missed while disconnected.
      // It is not a version delta: equal-version images must be rendered again.
      if (delta.full) {
        current.clear();
        touched = true;
      }
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

    if (!touched && incomingFiles.length === 0) return;

    applyingRemote.current = true;
    api.updateScene({ elements: [...current.values()], captureUpdate: "NEVER" });
    // Excalidraw's addFiles scans the CURRENT scene to populate its decoded-image
    // cache. Calling it before installing the image elements left catch-up images
    // blank until a later page switch or edit happened to trigger another scan.
    if (incomingFiles.length > 0) api.addFiles(incomingFiles);
    setMediaElements([...current.values()].filter((element) => element.type === "image" && !element.isDeleted));
    rememberVisibleBoardElements(visibleBeforeErase.current, [...current.values()]);
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
  }, [activePageId, api, pageChangedAt, sceneUpdates, onConsumeUpdates, readOnly, viewport]);

  // --- the server wiped the board at the start of a class ---
  useEffect(() => {
    if (!api || clearedAt === 0) return;
    sentVersions.current.clear();
    sentFiles.current.clear();
    visibleBeforeErase.current.clear();
    setMediaElements([]);
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
  const performClearAll = useCallback(() => {
    if (!api || boardReadOnly) return;
    sentVersions.current.clear();
    sentFiles.current.clear();
    visibleBeforeErase.current.clear();
    setMediaElements([]);
    applyingRemote.current = true;
    api.updateScene({ elements: [] });
    setTimeout(() => { applyingRemote.current = false; }, 0);
    onClearAll?.();
    api.setToast({ message: "Board cleared", duration: 2000 });
    setHistoryState({ undo: false, redo: false });
    setBoardDialog(null);
  }, [api, boardReadOnly, onClearAll]);

  const clearAll = useCallback(() => {
    if (!api || boardReadOnly) return;
    setBoardDialog({ kind: "clear" });
  }, [api, boardReadOnly]);

  const confirmBoardDialog = useCallback(() => {
    if (!boardDialog) return;
    if (boardDialog.kind === "clear") {
      performClearAll();
      return;
    }
    if (!activePage) return;
    if (boardDialog.kind === "rename") {
      const title = boardDialog.value.trim();
      if (!title) return;
      onPageCommand?.({ op: "rename", pageId: activePage.id, title });
    } else {
      onPageCommand?.({ op: "delete", pageId: activePage.id });
      setPageMenuOpen(false);
    }
    setBoardDialog(null);
  }, [activePage, boardDialog, onPageCommand, performClearAll]);

  /**
   * Put an uploaded document on the board as real elements.
   *
   * A photo used to be drawn *behind* the canvas and annotated over the top, and a PDF was
   * handed to every participant to render separately — which is how the teacher and the class
   * ended up looking at different things without either being able to tell. As elements they
   * are just objects: draggable, resizable, erasable, part of what a student's view is fitted
   * to, and synced by the same rules as a hand-drawn line.
   *
   * PDF pages are rasterised **here, once, on the sharer's device**. Students receive plain
   * pictures and never run a PDF engine, which is what matters on a market of cheap Android
   * phones. The engine is loaded on demand, so a teacher who never shares a PDF never
   * downloads it.
   */
  useEffect(() => {
    if (!api || boardReadOnly || !insertDocument) return;
    if (insertedImages.current.has(insertDocument.key)) return;
    insertedImages.current.add(insertDocument.key);

    let cancelled = false;
    let placed = false;
    const controller = new AbortController();

    const load = (src: string) =>
      new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new window.Image();
        const timer = setTimeout(() => { image.src = ""; reject(new Error("Image decoding timed out")); }, 20000);
        image.onload = () => { clearTimeout(timer); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
        image.onerror = () => { clearTimeout(timer); reject(new Error("Image could not be decoded")); };
        image.src = src;
      });

    const place = (entries: { width: number; height: number; dataUrl: string }[]) => {
      const state = api.getAppState();
      const zoom = state.zoom?.value ?? 1;
      const viewW = (state.width || 800) / zoom;
      const viewH = (state.height || 600) / zoom;

      const files: BinaryFile[] = [];
      const elements: Record<string, unknown>[] = [];
      const documentId = `document-${insertDocument.key}`;
      let cursorY = 0;
      let firstElement: Record<string, unknown> | null = null;
      // A second document gets its own space rather than being piled over the first one.
      const existing = api.getSceneElements().filter((element) => !element.isDeleted);
      const startX = existing.length ? Math.max(...existing.map((element) => Number(element.x) + Number(element.width))) + 64 : null;

      entries.forEach((entry, index) => {
        // Every page gets the same treatment: fill most of the view without overflowing it.
        const scale = Math.min(
          1,
          (viewW * 0.8) / entry.width,
          (viewH * 0.8) / entry.height,
        );
        const width = Math.max(1, Math.round(entry.width * scale));
        const height = Math.max(1, Math.round(entry.height * scale));
        const x = startX ?? -state.scrollX + (viewW - width) / 2;
        const y = -state.scrollY + (viewH - height) / 2 + cursorY;
        // Pages stack down the canvas in reading order, so scrolling the board scrolls the
        // document.
        cursorY += height + Math.round(height * 0.06);

        const fileId = `file-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
        const mimeMatch = /^data:([^;,]+)[;,]/.exec(entry.dataUrl);
        files.push({
          id: fileId,
          dataURL: entry.dataUrl,
          mimeType: mimeMatch ? mimeMatch[1] : "image/jpeg",
          created: Date.now(),
        });

        const element: Record<string, unknown> = {
          id: `img-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
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
          customData: insertDocument.kind === "pdf" ? { fadkoDocumentId: documentId, fadkoPage: index + 1, fadkoTotal: entries.length } : null,
          scale: [1, 1],
          crop: null,
        };
        elements.push(element);
        if (index === 0) firstElement = element;
      });

      applyingRemote.current = true;
      // Imported objects are local edits, not uncommitted remote deltas. Without this capture,
      // Excalidraw excludes later Files-panel changes from its history until a canvas gesture.
      api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...elements], captureUpdate: "IMMEDIATELY" });
      api.addFiles(files);
      setHistoryState({ undo: true, redo: false });
      setMediaElements((current) => [...current, ...(elements as ExcalidrawElement[])]);
      setTimeout(() => {
        applyingRemote.current = false;
        // Start at the top of the document. Fitting every page at once would shrink the text to
        // nothing; the teacher's view is broadcast, so students land on page one too.
        if (firstElement) {
          api.scrollToContent([firstElement], { fitToContent: true, animate: false, maxZoom: 1 });
        }
        flushRef.current();
        // Fitting can happen while onChange is suppressed. Publish the final view explicitly.
        scheduleViewportPublish();
      }, 0);
    };

    void (async () => {
      try {
        let entries: { width: number; height: number; dataUrl: string }[];
        let truncated = false;
        if (insertDocument.kind === "pdf") {
          api.setToast({ message: "Opening the PDF…", duration: 60000 });
          const { renderPdfToImages } = await import("../utils/pdfToImages");
          const result = await renderPdfToImages(insertDocument.dataUrl, ({ page, total }) => {
            if (!cancelled) api.setToast({ message: `Preparing PDF page ${page} of ${total}…`, duration: 60000 });
          }, controller.signal);
          if (cancelled) return;
          truncated = result.truncated;
          // pdf.js already knows every page's dimensions. Decoding 14 full-size Image objects
          // again in parallel can exhaust an iPhone after the progress reaches the last page.
          entries = result.pages.map((dataUrl, index) => ({ dataUrl, ...result.sizes[index] }));
        } else {
          entries = [{ dataUrl: insertDocument.dataUrl, ...await load(insertDocument.dataUrl) }];
        }
        if (cancelled) return;
        if (!entries.length || entries.some((entry) => !(entry.width > 0 && entry.height > 0))) throw new Error("No readable pages");
        place(entries);
        placed = true;
        api.setToast({ message: insertDocument.kind === "pdf"
          ? `${truncated ? "First " : ""}${entries.length} PDF ${entries.length === 1 ? "page added" : "pages added"}. Open Files to find each sheet.${truncated ? " This board imports up to 25 pages at a time." : ""}`
          : "Picture added to the board.", duration: 6500 });
      } catch {
        if (!cancelled) {
          insertedImages.current.delete(insertDocument.key);
          api.setToast({ message: "The file could not be added. Please try a smaller PDF or a photo. Your existing board is unchanged.", duration: 8000 });
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      // A teacher may switch pages while a PDF is still rendering. The next effect retries it
      // on the selected page; a completed placement keeps its key so it cannot be duplicated.
      if (!placed) insertedImages.current.delete(insertDocument.key);
    };
  }, [api, boardReadOnly, insertDocument, activePageId, scheduleViewportPublish]);

  const updateSelectedObjects = useCallback(
    (operation: "delete" | "duplicate" | "lock" | "unlock") => {
      if (!api || boardReadOnly || selectedIds.length === 0) return;
      const selected = new Set(selectedIds);
      const now = Date.now();
      const current = [...api.getSceneElementsIncludingDeleted()];
      let next: ExcalidrawElement[] = current;

      if (operation === "duplicate") {
        const copies = current
          .filter((element) => selected.has(element.id) && !element.isDeleted)
          .map((element, index) => ({
            ...element,
            id: `copy-${now}-${index}-${Math.random().toString(36).slice(2, 8)}`,
            x: typeof element.x === "number" ? element.x + 24 : element.x,
            y: typeof element.y === "number" ? element.y + 24 : element.y,
            version: 1,
            versionNonce: Math.floor(Math.random() * 1_000_000_000),
            updated: now,
            isDeleted: false,
            locked: false,
            groupIds: [],
            boundElements: null,
          }));
        next = [...current, ...copies];
      } else {
        next = current.map((element) => {
          if (!selected.has(element.id) || element.isDeleted) return element;
          return {
            ...element,
            ...(operation === "delete" ? { isDeleted: true } : { locked: operation === "lock" }),
            version: Math.max(1, Number(element.version) || 1) + 1,
            versionNonce: Math.floor(Math.random() * 1_000_000_000),
            updated: now,
          };
        });
      }

      api.updateScene({
        elements: next,
        appState: { selectedElementIds: {} },
        captureUpdate: "IMMEDIATELY",
      });
      setSelectedIds([]);
      setHistoryState({ undo: true, redo: false });
      api.setToast({
        message:
          operation === "delete"
            ? "Object deleted — Undo restores it"
            : operation === "duplicate"
              ? "Object duplicated"
              : operation === "unlock" ? "Object unlocked" : "Object locked",
        duration: 1800,
      });
      setTimeout(flush, 0);
    },
    [api, boardReadOnly, flush, selectedIds],
  );

  const selectionToolbar = !boardReadOnly && selectedIds.length > 0 ? (
    <div
      role="toolbar"
      aria-label="Selected object actions"
      data-testid="board-selection-toolbar"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 132,
        zIndex: 12,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: 6,
        border: "1px solid rgba(15,23,42,0.14)",
        borderRadius: 16,
        background: "rgba(255,255,255,0.96)",
        boxShadow: "0 14px 38px rgba(15,23,42,0.2)",
        backdropFilter: "blur(18px)",
        transform: "translateX(-50%)",
      }}
    >
      <button
        type="button"
        title="Delete selected object"
        aria-label="Delete selected object"
        data-testid="board-delete-selection"
        onClick={() => updateSelectedObjects("delete")}
        style={{ ...pageMenuButtonStyle, display: "flex", alignItems: "center", gap: 6, color: "var(--color-danger, firebrick)" }}
      >
        <TrashIcon /> Delete
      </button>
      <button
        type="button"
        title="Duplicate selected object"
        aria-label="Duplicate selected object"
        data-testid="board-duplicate-selection"
        onClick={() => updateSelectedObjects("duplicate")}
        style={pageMenuButtonStyle}
      >
        Duplicate
      </button>
      <button
        type="button"
        title={selectionLocked ? "Unlock selected object" : "Lock selected object"}
        aria-label={selectionLocked ? "Unlock selected object" : "Lock selected object"}
        data-testid="board-lock-selection"
        onClick={() => updateSelectedObjects(selectionLocked ? "unlock" : "lock")}
        style={pageMenuButtonStyle}
      >
        {selectionLocked ? "Unlock" : "Lock"}
      </button>
    </div>
  ) : null;

  useEffect(() => {
    const root = boardRootRef.current;
    if (!root || typeof MutationObserver === "undefined") return;
    const labelControls = () => {
      root.querySelectorAll<HTMLElement>("button[aria-label], [role='button'][aria-label]").forEach((control) => {
        const label = control.getAttribute("aria-label");
        if (label && !control.getAttribute("title")) control.setAttribute("title", label);
      });
    };
    labelControls();
    const observer = new MutationObserver(labelControls);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
    return () => observer.disconnect();
  }, [api]);

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

  const bringEveryoneHere = useCallback(() => {
    sentView.current = null;
    publishViewport(true);
    api?.setToast({ message: "Bringing everyone to this view", duration: 2200 });
  }, [api, publishViewport]);

  const renderTopRightUI = useCallback(() => {
    if (boardReadOnly) return null;
    return (
      // The class name is what hides this on a phone — see BOARD_CSS. It cannot be a
      // conditional render here, because this callback does not re-run when the editor
      // changes layout.
      <div className="sikshya-board__top-right" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {classroomChrome && wideToolbar ? historyControls : null}
        <button
          type="button"
          onClick={toggleLaser}
          title="Point for the class"
          aria-label="Point for the class"
          aria-pressed={laserMode}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid var(--default-border-color, silver)",
            background: laserMode ? "var(--color-primary, navy)" : "var(--island-bg-color, white)",
            color: laserMode ? "white" : "var(--text-primary-color, black)",
            cursor: "pointer",
          }}
        >
          <LaserIcon />
        </button>
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
            border: "1px solid var(--default-border-color, silver)",
            background: showProps ? "var(--color-primary, navy)" : "var(--island-bg-color, white)",
            color: showProps ? "white" : "var(--text-primary-color, black)",
            cursor: "pointer",
          }}
        >
          <SlidersIcon />
        </button>
        <button
          type="button"
          onClick={clearAll}
          title="Clear this page for the whole class"
          aria-label="Clear this page for the whole class"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 44,
            height: 44,
            borderRadius: 8,
            border: "1px solid var(--default-border-color, silver)",
            background: "var(--island-bg-color, white)",
            color: "var(--color-danger, firebrick)",
            cursor: "pointer",
          }}
        >
          <TrashIcon />
        </button>
      </div>
    );
  }, [boardReadOnly, clearAll, laserMode, setPropsVisible, showProps, toggleLaser, historyControls, classroomChrome, wideToolbar]);

  const initialData = useMemo(
    () => ({
      /**
       * The Library panel opens on shapes built for teaching.
       *
       * Excalidraw's own button browses community collections hosted on excalidraw.com —
       * flowchart icons, UML, cloud architecture — which is no use to a tutor explaining
       * fractions, and often does not load at all on a poor connection. See boardLibrary.ts;
       * adding a shape there is all it takes to add one here.
       */
      libraryItems: teachingLibrary(),
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
      ref={boardRootRef}
      className={`sikshya-board${showProps ? "" : " sikshya-board--hide-props"}${classroomChrome ? " sikshya-board--classroom" : ""}${zoomMenuOpen || pageMenuOpen || materialsOpen || colorMenuOpen ? " sikshya-board--panel-open" : ""}`}
      style={{ position: "absolute", inset: 0, overflow: "hidden",
        "--color-primary": colors.primary, "--color-primary-light": colors.actionSoft,
        "--color-danger": colors.destructive, "--text-primary-color": colors.foreground,
        "--text-muted-color": colors.mutedForeground, "--default-border-color": colors.border,
        fontFamily: "system-ui, sans-serif",
      } as React.CSSProperties}
      onPointerMove={handleLaserMove}
      onPointerLeave={stopLaser}
      onContextMenuCapture={(event) => {
        // Keep the editor's own context menu, but never stack the browser's menu over it.
        event.preventDefault();
      }}
    >
      <style>{BOARD_CSS}</style>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", ...templateStyle(activePage?.template ?? "blank") }} />
      <div className="sikshya-board__editor" style={{ position: "absolute", inset: 0, pointerEvents: readOnly ? "none" : "auto" }}>
      <Excalidraw
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        excalidrawAPI={(a: any) => setApi(a as ExcalidrawAPI)}
        onChange={handleChange}
        onScrollChange={handleScrollChange}
        onPointerDown={handlePointerDown}
        initialData={initialData}
        viewModeEnabled={boardReadOnly}
        theme={theme}
        renderTopRightUI={renderTopRightUI}
        UIOptions={{
          canvasActions: {
            // The class owns the board; letting one person load a file over it, or change the
            // background mid-lesson, is confusing for everyone else.
            loadScene: false,
            saveToActiveFile: false,
            export: boardReadOnly ? false : { saveFileToDisk: true },
            toggleTheme: false,
          },
        }}
      >
        <MainMenu>
          {!readOnly && <MainMenu.Item onSelect={() => setMaterialsOpen(true)}>
            Materials: unlock or remove
          </MainMenu.Item>}
          {!boardReadOnly && (
            <MainMenu.Item onSelect={bringEveryoneHere} icon={<EyeIcon />}>
              Bring everyone to my view
            </MainMenu.Item>
          )}
          {!boardReadOnly && (
            <MainMenu.Item onSelect={clearAll} icon={<TrashIcon />}>
              Clear this page for the whole class
            </MainMenu.Item>
          )}
          <MainMenu.DefaultItems.SaveAsImage />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Heading>
              {boardReadOnly ? "Your teacher's board" : "Your board — start teaching"}
            </WelcomeScreen.Center.Heading>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </Excalidraw>
      </div>

      {!readOnly ? pageNavigator : null}
      {!classroomChrome || !wideToolbar ? historyControls : null}
      {selectionToolbar}

      {boardDialog ? (
        <div
          role="presentation"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 30,
            display: "grid",
            placeItems: "center",
            padding: 20,
            background: "rgba(15,23,42,0.42)",
            backdropFilter: "blur(4px)",
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setBoardDialog(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="board-dialog-title"
            style={{
              width: "min(100%, 420px)",
              display: "grid",
              gap: 16,
              padding: 22,
              borderRadius: 20,
              border: "1px solid rgba(15,23,42,0.12)",
              background: "rgba(255,255,255,0.98)",
              boxShadow: "0 24px 70px rgba(15,23,42,0.28)",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <div style={{ display: "grid", gap: 6 }}>
              <strong id="board-dialog-title" style={{ color: "var(--text-primary-color, black)", fontSize: "1.25rem" }}>
                {boardDialog.kind === "rename"
                  ? "Rename this page"
                  : boardDialog.kind === "delete"
                    ? `Delete “${boardDialog.pageTitle}”?`
                    : "Clear this page for everyone?"}
              </strong>
              <span style={{ color: "var(--text-secondary-color, slategray)", fontSize: "0.875rem", lineHeight: 1.45 }}>
                {boardDialog.kind === "rename"
                  ? "Use a short name students can recognize during class."
                  : boardDialog.kind === "delete"
                    ? "This removes the page and its board work from the class."
                    : "This removes every object and note on the current page."}
              </span>
            </div>
            {boardDialog.kind === "rename" ? (
              <input
                autoFocus
                value={boardDialog.value}
                maxLength={80}
                aria-label="Board page name"
                onChange={(event) => setBoardDialog({ kind: "rename", value: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") confirmBoardDialog();
                  if (event.key === "Escape") setBoardDialog(null);
                }}
                style={{
                  minHeight: 48,
                  padding: "0 14px",
                  borderRadius: 12,
                  border: "1px solid var(--default-border-color, silver)",
                  color: "var(--text-primary-color, black)",
                  background: "var(--island-bg-color, white)",
                  fontSize: "1rem",
                  outlineColor: "var(--color-primary, navy)",
                }}
              />
            ) : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" onClick={() => setBoardDialog(null)} style={pageButtonStyle}>
                Go back
              </button>
              <button
                type="button"
                onClick={confirmBoardDialog}
                disabled={boardDialog.kind === "rename" && !boardDialog.value.trim()}
                style={{
                  ...pageButtonStyle,
                  borderColor: boardDialog.kind === "rename" ? "var(--color-primary, navy)" : "var(--color-danger, firebrick)",
                  background: boardDialog.kind === "rename" ? "var(--color-primary, navy)" : "var(--color-danger, firebrick)",
                  color: "white",
                  fontWeight: 700,
                }}
              >
                {boardDialog.kind === "rename" ? "Save name" : boardDialog.kind === "delete" ? "Delete page" : "Clear page"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {laser?.active ? (
        <div
          aria-label="Teacher laser pointer"
          style={{
            position: "absolute",
            left: `${laser.x * 100}%`,
            top: `${laser.y * 100}%`,
            width: 24,
            height: 24,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(239,68,68,1) 0 18%, rgba(239,68,68,0.36) 42%, transparent 72%)",
            pointerEvents: "none",
            zIndex: 9,
          }}
        />
      ) : null}

    </div>
  );
}

/**
 * The classroom timer and LiveKit presence update frequently. None of that should make the
 * editor rebuild its toolbar or selected-tool island. Only board-specific inputs cross this
 * boundary, which also keeps Excalidraw's own undo stack alive during call reconnects.
 */
function boardPropsEqual(previous: Props, next: Props): boolean {
  return (
    previous.readOnly === next.readOnly &&
    previous.classroomChrome === next.classroomChrome &&
    previous.sceneUpdates === next.sceneUpdates &&
    previous.onConsumeUpdates === next.onConsumeUpdates &&
    previous.onSceneChange === next.onSceneChange &&
    previous.insertDocument === next.insertDocument &&
    previous.onViewportChange === next.onViewportChange &&
    previous.viewport === next.viewport &&
    previous.onClearAll === next.onClearAll &&
    previous.clearedAt === next.clearedAt &&
    previous.pages === next.pages &&
    previous.activePageId === next.activePageId &&
    previous.pageChangedAt === next.pageChangedAt &&
    previous.onPageCommand === next.onPageCommand &&
    previous.laser === next.laser &&
    previous.onLaser === next.onLaser &&
    previous.theme === next.theme
  );
}

export default memo(SmartBoard, boardPropsEqual);
