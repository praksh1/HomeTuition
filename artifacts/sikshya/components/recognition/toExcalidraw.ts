/**
 * Turning a recognised shape into something the board can draw.
 *
 * Kept apart from both the recogniser and the board, for the same reason the recogniser is kept
 * apart from the drawing surface: this is the only part that knows what Excalidraw is. It takes
 * a shape that has already been recognised rather than recognising one itself, which keeps its
 * only imports type-only — so what a rough circle becomes can be checked without a browser, a
 * bundler, or the recogniser.
 *
 * The output is a *skeleton* rather than a finished element. Excalidraw elements carry a dozen
 * fields nobody should be writing by hand — version counters, seeds, nonces, binding state —
 * and `convertToExcalidrawElements` fills them in. Writing them here would be a second, worse
 * copy of that, out of date the first time the library changed.
 */
import type { Point, RecognizedShape } from "./recognizeShape";

/** The parts of a freehand element this needs. Narrow, so it can be tested with a literal. */
export interface FreehandElement {
  x: number;
  y: number;
  /** Excalidraw stores freehand points relative to the element's own origin. */
  points: readonly (readonly number[])[];
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  opacity?: number;
}

/** What `convertToExcalidrawElements` accepts. Loose on purpose: the library owns the shape. */
export type ShapeSkeleton = Record<string, unknown> & { type: string };

/**
 * Style is carried across so the shape looks like what the teacher was already drawing with.
 *
 * Without it, correcting a stroke would also silently change its colour and thickness to the
 * board's defaults — which reads as the board having drawn something of its own, rather than
 * having tidied up yours.
 */
function styleOf(el: FreehandElement): Record<string, unknown> {
  const style: Record<string, unknown> = {};
  if (el.strokeColor !== undefined) style.strokeColor = el.strokeColor;
  if (el.backgroundColor !== undefined) style.backgroundColor = el.backgroundColor;
  if (el.fillStyle !== undefined) style.fillStyle = el.fillStyle;
  if (el.strokeWidth !== undefined) style.strokeWidth = el.strokeWidth;
  if (el.strokeStyle !== undefined) style.strokeStyle = el.strokeStyle;
  if (el.roughness !== undefined) style.roughness = el.roughness;
  if (el.opacity !== undefined) style.opacity = el.opacity;
  return style;
}

/** Freehand points are element-relative; the recogniser works in board coordinates. */
export function absolutePoints(el: FreehandElement): Point[] {
  return el.points
    .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => ({ x: el.x + p[0], y: el.y + p[1] }));
}

/**
 * The element to draw in place of the stroke, or `null` if this shape cannot be drawn.
 *
 * Null here means the recogniser produced something incomplete — an arrow with no endpoints, a
 * triangle with two corners — which should leave the teacher's ink exactly where it is. The
 * decision *whether* to replace at all is the caller's, and is made on confidence.
 */
export function skeletonFor(shape: RecognizedShape, el: FreehandElement): ShapeSkeleton | null {
  const style = styleOf(el);
  const { x, y, width, height } = shape.bounds;

  switch (shape.kind) {
    case "rectangle":
      return { type: "rectangle", x, y, width, height, ...style };

    case "ellipse":
      return { type: "ellipse", x, y, width, height, ...style };

    case "line":
    case "arrow": {
      const { from, to } = shape;
      if (!from || !to) return null;
      return {
        type: shape.kind,
        x: from.x,
        y: from.y,
        points: [
          [0, 0],
          [to.x - from.x, to.y - from.y],
        ],
        ...style,
      };
    }

    case "triangle": {
      const [a, b, c] = shape.points ?? [];
      if (!a || !b || !c) return null;
      // Closed by returning to the first corner: an open three-point line leaves a triangle
      // with one side missing, which reads as the board getting it wrong rather than helping.
      return {
        type: "line",
        x: a.x,
        y: a.y,
        points: [
          [0, 0],
          [b.x - a.x, b.y - a.y],
          [c.x - a.x, c.y - a.y],
          [0, 0],
        ],
        ...style,
      };
    }

    default:
      return null;
  }
}
