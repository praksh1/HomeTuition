import type { DrawPath } from "../../hooks/useClassroomSocket";
import type { RecognizedShape } from "./recognizeShape";

/**
 * Converts a recognised shape into the board's existing wire format.
 *
 * Deliberately no new message types. The classroom protocol already carries lines, arrows,
 * circles, rectangles and freehand paths, and every client and the server's replay buffer
 * already understand them. Ellipses and triangles — which the protocol has no word for — are
 * expressed as ordinary freehand paths whose `d` happens to be perfect geometry.
 *
 * The result is that a student on a phone that has not been updated still sees the teacher's
 * snapped shapes correctly, and the server needed no change at all. When the drawing engine is
 * replaced later, this is the one file that has to learn the new format.
 */
export function toDrawPath(
  shape: RecognizedShape,
  color: string,
  width: number,
  opacity?: number,
): DrawPath | null {
  const base = { color, width, opacity };
  const { bounds: b } = shape;

  switch (shape.kind) {
    case "line":
      if (!shape.from || !shape.to) return null;
      return { ...base, tool: "line", x1: shape.from.x, y1: shape.from.y, x2: shape.to.x, y2: shape.to.y };

    case "arrow":
      if (!shape.from || !shape.to) return null;
      return { ...base, tool: "arrow", x1: shape.from.x, y1: shape.from.y, x2: shape.to.x, y2: shape.to.y };

    case "rectangle":
      return { ...base, tool: "rect", x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height };

    case "ellipse": {
      const rx = b.width / 2;
      const ry = b.height / 2;
      const cx = b.x + rx;
      const cy = b.y + ry;
      // A near-circle uses the protocol's own circle, which stays a first-class object.
      if (shape.regular) {
        return { ...base, tool: "circle", cx, cy, r: (rx + ry) / 2 };
      }
      // A genuine oval is drawn as two arcs. Two are needed because a single elliptical arc
      // spanning 360 degrees is degenerate in SVG — start and end coincide, so nothing renders.
      const d =
        `M${(cx - rx).toFixed(1)},${cy.toFixed(1)} ` +
        `a${rx.toFixed(1)},${ry.toFixed(1)} 0 1,0 ${(rx * 2).toFixed(1)},0 ` +
        `a${rx.toFixed(1)},${ry.toFixed(1)} 0 1,0 ${(-rx * 2).toFixed(1)},0`;
      return { ...base, tool: "pen", d };
    }

    case "triangle": {
      const p = shape.points;
      if (!p || p.length < 3) return null;
      const d =
        `M${p[0].x.toFixed(1)},${p[0].y.toFixed(1)} ` +
        `L${p[1].x.toFixed(1)},${p[1].y.toFixed(1)} ` +
        `L${p[2].x.toFixed(1)},${p[2].y.toFixed(1)} Z`;
      return { ...base, tool: "pen", d };
    }

    default:
      return null;
  }
}
