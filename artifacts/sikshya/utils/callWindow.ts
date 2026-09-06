/**
 * Where the call window is, how big, and what each button does to it.
 *
 * One file, shared by both classrooms, and pure — no React, no styles, no imports. Two screens
 * with the same window written twice is two screens with the window written *differently*,
 * eventually; the same argument `sessionWindow.ts` makes about the clock.
 *
 * ### The complaint this answers
 *
 * The owner reported the minus button as doing nothing. It was not nothing — it toggled between
 * two docked sizes that differ by about a finger's width on a phone, and it left the window
 * wherever it had been dragged. From the outside that is indistinguishable from a dead control.
 *
 * So minus is now a **snap**: from any visible size it goes to `compact` **and returns the window
 * to the bottom-right corner**. Somewhere it went is not the same as somewhere you can find.
 *
 * ### The four states
 *
 * | | what it is | why |
 * |---|---|---|
 * | `hidden` | mounted, painted nowhere, touch passes through | the board gets the whole screen; the call keeps running |
 * | `compact` | a small preview snapped to the bottom-right | proof the call is alive, not a control surface |
 * | `normal` | draggable, large enough to work Daily's own controls | the working size |
 * | `full` | the whole safe area | screen share, and reading what a student wrote |
 *
 * `compact` deliberately does **not** try to show a provider's control row. Daily's controls do
 * not fit in a thumbnail; a row of half-buttons nobody can hit is worse than none, so compact
 * offers exactly one thing — Restore — and the geometry below guarantees room for it.
 */

export type CallWindowState = "hidden" | "compact" | "normal" | "full";

/** What the classrooms have always called their sizes, kept so nothing else has to be renamed. */
export type LegacyVideoWindowSize = "hidden" | "small" | "medium" | "full";

export const LEGACY_TO_STATE: Record<LegacyVideoWindowSize, CallWindowState> = {
  hidden: "hidden",
  small: "compact",
  medium: "normal",
  full: "full",
};

export interface CallWindowModel {
  state: CallWindowState;
  /**
   * The state to come back to when Show is pressed.
   *
   * Never `hidden`, so Show always shows something. It remembers `full` too: somebody who hid a
   * full-screen call to check the board expects it back the size it was.
   */
  lastVisible: Exclude<CallWindowState, "hidden">;
  /** Which of the two windowed sizes Maximize returns to. Never `full`, never `hidden`. */
  lastWindowed: "compact" | "normal";
  /** Offset from the window's docked corner, in points. Reset by minimise, kept by drag. */
  offset: { x: number; y: number };
}

export function initialCallWindow(): CallWindowModel {
  return { state: "compact", lastVisible: "compact", lastWindowed: "compact", offset: { x: 0, y: 0 } };
}

export type CallWindowAction =
  | { type: "hide" }
  | { type: "show" }
  /** The minus button. Always ends at compact, always back in the corner. */
  | { type: "minimize" }
  /** The maximise button. Toggles between full and whichever windowed size was last used. */
  | { type: "toggle-full" }
  /**
   * Compact's one control. Goes to the working size, not to full screen.
   *
   * A thumbnail's Restore means "give me the window back", and the window somebody was working
   * in is `normal`. Sending them to full screen would bury the whiteboard instead.
   */
  | { type: "restore" }
  | { type: "drag"; dx: number; dy: number }
  /** The viewport changed — rotation, a resized browser. Positions are re-clamped, not reset. */
  | { type: "viewport"; bounds: DragBounds };

export function callWindowReducer(model: CallWindowModel, action: CallWindowAction): CallWindowModel {
  switch (action.type) {
    case "hide":
      if (model.state === "hidden") return model;
      return {
        ...model,
        state: "hidden",
        lastVisible: model.state,
        lastWindowed: model.state === "full" ? model.lastWindowed : model.state,
      };

    case "show":
      // Always something. `lastVisible` can never be hidden, so this cannot no-op.
      return model.state === "hidden" ? { ...model, state: model.lastVisible } : model;

    case "minimize": {
      /**
       * The fix for "the minus button does nothing".
       *
       * From `normal` **or** `full` — and from `hidden`, where it also means "show me the small
       * one" — this lands on `compact` and puts the window back in the bottom-right corner. The
       * old behaviour toggled `small`/`medium`, two sizes a finger apart, and left the window
       * wherever it had been dragged to, which is why it read as broken.
       */
      if (model.state === "compact" && model.offset.x === 0 && model.offset.y === 0) return model;
      return { ...model, state: "compact", lastVisible: "compact", lastWindowed: "compact", offset: { x: 0, y: 0 } };
    }

    case "restore":
      return { ...model, state: "normal", lastVisible: "normal", lastWindowed: "normal" };

    case "toggle-full": {
      if (model.state === "full") {
        const back = model.lastWindowed;
        return { ...model, state: back, lastVisible: back };
      }
      return {
        ...model,
        state: "full",
        lastVisible: "full",
        // Hidden is not a size to come back to; keep whatever windowed size was last real.
        lastWindowed: model.state === "hidden" ? model.lastWindowed : (model.state as "compact" | "normal"),
        // Full is pinned to the safe area, so any drag offset is meaningless while it lasts.
        offset: { x: 0, y: 0 },
      };
    }

    case "drag":
      // Only a window that is *there* and not pinned can be moved.
      if (model.state === "hidden" || model.state === "full") return model;
      return { ...model, offset: { x: model.offset.x + action.dx, y: model.offset.y + action.dy } };

    case "viewport":
      return { ...model, offset: clampOffset(model.offset, action.bounds) };
  }
}

/* ---------------------------------------------------------------------------
 * Geometry
 * ------------------------------------------------------------------------- */

export interface Viewport {
  width: number;
  height: number;
  insets: { top: number; bottom: number; left: number; right: number };
  /** Room the board's own toolbars need at the top and bottom. Never covered. */
  reservedTop: number;
  reservedBottom: number;
  /** The smallest tap target this project allows. Compact is sized around it. */
  hitSlopMin: number;
}

export interface WindowRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface DragBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Compact is a preview plus one row that must stay tappable. Nothing smaller is honest. */
export function compactSize(v: Viewport): { width: number; height: number } {
  const width = Math.min(Math.max(v.hitSlopMin * 3, 132), Math.max(120, v.width - v.hitSlopMin * 2));
  // 16:9 for the picture, plus one full tap target for the header that carries Restore.
  return { width, height: Math.round((width * 9) / 16) + v.hitSlopMin };
}

/** Normal has to be big enough to work a provider's own control row. */
export function normalSize(v: Viewport): { width: number; height: number } {
  const available = v.width - v.insets.left - v.insets.right - 16;
  const width = Math.min(Math.max(280, available), 420);
  return { width: Math.max(200, width), height: Math.round((width * 9) / 16) + v.hitSlopMin };
}

/**
 * Where the window sits, for a given state.
 *
 * `hidden` still returns a rectangle. The call is mounted the whole time — hiding it must never
 * unmount Daily — so it needs somewhere to be; the classroom paints it with zero opacity and
 * `pointerEvents: none`, and the board gets every touch.
 */
export function windowRect(state: CallWindowState, v: Viewport, offset = { x: 0, y: 0 }): WindowRect {
  if (state === "full") {
    return {
      top: v.insets.top,
      left: v.insets.left,
      width: Math.max(0, v.width - v.insets.left - v.insets.right),
      height: Math.max(0, v.height - v.insets.top - v.insets.bottom),
    };
  }

  const size = state === "normal" ? normalSize(v) : compactSize(v);
  const bounds = dragBounds(state, v);
  // Docked bottom-right, then moved by however far it has been dragged — clamped, always.
  const dockedLeft = v.width - v.insets.right - size.width - 8;
  const dockedTop = v.height - v.insets.bottom - v.reservedBottom - size.height - 8;
  const point = clampPoint({ x: dockedLeft + offset.x, y: dockedTop + offset.y }, bounds);
  return { top: point.y, left: point.x, width: size.width, height: size.height };
}

/**
 * How far the window may be moved before part of it leaves the screen or covers a board control.
 *
 * The bounds are absolute positions, not offsets, so a rotation changes them and the same offset
 * is simply re-clamped against the new ones — which is what stops a window rotating off-screen.
 */
export function dragBounds(state: CallWindowState, v: Viewport): DragBounds {
  const size = state === "normal" ? normalSize(v) : compactSize(v);
  const minX = v.insets.left + 8;
  const maxX = Math.max(minX, v.width - v.insets.right - size.width - 8);
  const minY = v.insets.top + v.reservedTop;
  const maxY = Math.max(minY, v.height - v.insets.bottom - v.reservedBottom - size.height);
  return { minX, maxX, minY, maxY };
}

export function clampPoint(p: { x: number; y: number }, b: DragBounds): { x: number; y: number } {
  return {
    x: Math.min(b.maxX, Math.max(b.minX, p.x)),
    y: Math.min(b.maxY, Math.max(b.minY, p.y)),
  };
}

/** Clamp a stored *offset* after the viewport changed, so nothing is left off-screen. */
export function clampOffset(offset: { x: number; y: number }, b: DragBounds): { x: number; y: number } {
  const span = { x: b.maxX - b.minX, y: b.maxY - b.minY };
  return {
    x: Math.min(0, Math.max(-span.x, offset.x)),
    y: Math.min(0, Math.max(-span.y, offset.y)),
  };
}

/* ---------------------------------------------------------------------------
 * What the window offers, and to whom
 * ------------------------------------------------------------------------- */

export interface CallWindowControls {
  /** Hide and Show are one button with two faces, and stay separate from minimise. */
  canHide: boolean;
  canShow: boolean;
  /** Minus. Meaningless only when already compact and already parked. */
  canMinimize: boolean;
  canToggleFull: boolean;
  /** Whether a drag handle is offered at all. Full is pinned; hidden is not there. */
  canDrag: boolean;
  /** Whether the window's own frame should accept touches, or let the board have them. */
  interactive: boolean;
  /** Compact is a preview: one control, not a row of unusable ones. */
  showsProviderControls: boolean;
}

export function callWindowControls(model: CallWindowModel): CallWindowControls {
  const hidden = model.state === "hidden";
  const parkedCompact = model.state === "compact" && model.offset.x === 0 && model.offset.y === 0;
  return {
    canHide: !hidden,
    canShow: hidden,
    canMinimize: !parkedCompact,
    canToggleFull: !hidden,
    canDrag: model.state === "compact" || model.state === "normal",
    interactive: !hidden,
    showsProviderControls: model.state === "normal" || model.state === "full",
  };
}
