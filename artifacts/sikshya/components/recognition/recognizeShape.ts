/**
 * Turns a rough freehand stroke into the shape the person meant to draw.
 *
 * A teacher sketching a circle on a moving bus, or with a finger on a phone, produces
 * something lumpy. Recognising the intent and replacing the lumpy path with a clean vector is
 * the single biggest difference between "a drawing app" and a teaching board: a snapped circle
 * can be resized, rotated and re-coloured later, while a thousand-point freehand blob can only
 * be erased.
 *
 * This is deliberately dependency-free and pure. It runs identically on the web build and
 * inside the native app, needs no model download, and costs well under a millisecond — so it
 * can run on every stroke as it is committed without the board ever feeling slow. Nepal is a
 * low-bandwidth market; anything that needed a server round-trip per stroke would be unusable.
 *
 * The classifier is geometric rather than learned. Learned models are better at messy input,
 * but they need to ship weights, they are hard to debug when a teacher says "it keeps turning
 * my triangle into a circle", and they cannot explain themselves. Geometry gets the common
 * cases right and, importantly, *knows when it is unsure* — an unrecognised stroke is left as
 * freehand rather than being forced into the nearest shape.
 */

export interface Point {
  x: number;
  y: number;
}

export type RecognizedKind = "line" | "arrow" | "rectangle" | "ellipse" | "triangle";

export interface RecognizedShape {
  kind: RecognizedKind;
  /** 0..1. Below `MIN_CONFIDENCE` the caller should keep the original freehand stroke. */
  confidence: number;
  /** Axis-aligned bounds of the drawn stroke, in board coordinates. */
  bounds: { x: number; y: number; width: number; height: number };
  /** Endpoints, for the shapes where direction is meaningful. */
  from?: Point;
  to?: Point;
  /** Corner points for a triangle, in draw order. */
  points?: Point[];
  /** True when the stroke was close enough to a perfect square/circle to snap to one. */
  regular?: boolean;
}

/** Strokes recognised below this are left as freehand — a wrong guess is worse than none. */
export const MIN_CONFIDENCE = 0.62;

/** Ignore specks: a tap or a full stop should not become a tiny circle. */
const MIN_SIZE = 12;
const RESAMPLE_COUNT = 64;

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pathLength(pts: Point[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

function boundsOf(pts: Point[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Even out the spacing between points.
 *
 * Raw pointer samples bunch up where the hand slowed down and spread out where it moved fast,
 * which skews every measurement below — a slow corner would look like a dense cluster of
 * "corners". Resampling to constant arc length makes the maths depend on the shape rather than
 * on how fast it was drawn.
 */
function resample(pts: Point[], count = RESAMPLE_COUNT): Point[] {
  const total = pathLength(pts);
  if (total === 0 || pts.length < 2) return pts.slice();

  const step = total / (count - 1);
  const out: Point[] = [pts[0]];
  let carried = 0;

  for (let i = 1; i < pts.length; i++) {
    let segment = dist(pts[i - 1], pts[i]);
    let from = pts[i - 1];
    while (carried + segment >= step && out.length < count) {
      const t = (step - carried) / segment;
      const next = { x: from.x + t * (pts[i].x - from.x), y: from.y + t * (pts[i].y - from.y) };
      out.push(next);
      segment -= step - carried;
      carried = 0;
      from = next;
    }
    carried += segment;
  }
  while (out.length < count) out.push(pts[pts.length - 1]);
  return out;
}

/** Signed turn at each point, in radians, from a resampled stroke. */
function turnAngles(pts: Point[]): number[] {
  const angles: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
    const b = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    angles.push(d);
  }
  return angles;
}

/**
 * Corners, found by accumulating turn over a short window.
 *
 * A single sample's turn is noisy — hand tremor alone produces plenty of small angles. A real
 * corner is a large *sustained* change of direction, so turn is summed across a sliding window
 * and only the local peak of each run is kept, which stops one corner being counted three
 * times.
 */
function findCorners(pts: Point[], threshold = 1.0): number[] {
  const angles = turnAngles(pts);
  const window = 3;
  const scores: number[] = [];
  for (let i = 0; i < angles.length; i++) {
    let sum = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(angles.length - 1, i + window); j++) {
      sum += angles[j];
    }
    scores.push(Math.abs(sum));
  }

  const corners: number[] = [];
  let i = 0;
  while (i < scores.length) {
    if (scores[i] < threshold) { i++; continue; }
    let best = i;
    let j = i;
    while (j < scores.length && scores[j] >= threshold) {
      if (scores[j] > scores[best]) best = j;
      j++;
    }
    corners.push(best + 1); // +1: scores are offset by one from the point array
    i = j;
  }
  return corners;
}

/** How well the stroke sits on a single straight line, 1 = perfectly straight. */
function straightness(pts: Point[]): number {
  const direct = dist(pts[0], pts[pts.length - 1]);
  const along = pathLength(pts);
  if (along === 0) return 0;
  return direct / along;
}

/**
 * How well the stroke sits on an ellipse inscribed in its own bounding box.
 *
 * Each point is mapped into the unit circle's frame; on a perfect ellipse every point lands at
 * radius 1, so the average deviation from 1 is a direct measure of fit. This works for ovals as
 * well as circles, which matters — teachers draw wide ellipses round things constantly.
 */
function ellipseFit(pts: Point[], b: { x: number; y: number; width: number; height: number }): number {
  const rx = b.width / 2;
  const ry = b.height / 2;
  if (rx < 1 || ry < 1) return 0;
  const cx = b.x + rx;
  const cy = b.y + ry;

  let error = 0;
  for (const p of pts) {
    const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
    error += Math.abs(r - 1);
  }
  return Math.max(0, 1 - error / pts.length);
}

/** How well the stroke hugs the edges of its own bounding box. */
function rectangleFit(pts: Point[], b: { x: number; y: number; width: number; height: number }): number {
  if (b.width < 1 || b.height < 1) return 0;
  const tolerance = Math.max(b.width, b.height) * 0.07;

  let on = 0;
  for (const p of pts) {
    const dx = Math.min(Math.abs(p.x - b.x), Math.abs(p.x - (b.x + b.width)));
    const dy = Math.min(Math.abs(p.y - b.y), Math.abs(p.y - (b.y + b.height)));
    if (dx <= tolerance || dy <= tolerance) on++;
  }
  return on / pts.length;
}

/**
 * Was this stroke drawn as a closed loop?
 *
 * Judged against the stroke's own size, so a small circle and a large one are held to the same
 * standard. People rarely close a loop exactly; they overshoot or stop short.
 */
function isClosed(pts: Point[], b: { width: number; height: number }): boolean {
  const gap = dist(pts[0], pts[pts.length - 1]);
  const scale = Math.hypot(b.width, b.height);
  return scale > 0 && gap / scale < 0.28;
}

/**
 * Does the stroke end in an arrowhead?
 *
 * An arrow is drawn as one gesture: a long shaft, then a sharp reversal for the head. So the
 * tell is a large direction change close to the end, with only a short tail after it.
 */
function arrowhead(pts: Point[]): boolean {
  const angles = turnAngles(pts);
  if (angles.length < 8) return false;
  const tailStart = Math.floor(angles.length * 0.6);

  /**
   * Turn is summed over a short window rather than read off a single sample.
   *
   * Resampling spreads a sharp corner across two or three points, so the barb of an arrow —
   * a genuine turn of about 143° — arrived as 1.52 and 0.98 radians side by side. Testing each
   * on its own found neither above the threshold, and *every* arrow was recognised as a plain
   * line instead. This is the same accumulation `findCorners` below uses, and for the same
   * reason. A smooth curve cannot reach the threshold this way: a stroke resampled to 64 points
   * turns about 0.1 radians per sample, so three of them sum to well under a third of it.
   */
  const WINDOW = 2;
  for (let i = tailStart; i < angles.length; i++) {
    let sum = 0;
    for (let k = i; k < Math.min(angles.length, i + WINDOW); k++) sum += angles[k];
    if (Math.abs(sum) > 1.6) return true;
  }
  return false;
}


/**
 * Fill thresholds, from the geometry itself: a rectangle covers its bounding box entirely, an
 * ellipse covers pi/4 (~0.785) of it, a triangle half. The bands sit between those values, and
 * anything below the triangle band is not a closed shape at all.
 */
const RECT_FILL = 0.88;
const ELLIPSE_FILL = 0.63;
const TRIANGLE_FILL = 0.40;

/** Enclosed area of the stroke treated as a closed polygon (shoelace formula). */
function polygonArea(pts: Point[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(sum) / 2;
}

function triangleArea(a: Point, b: Point, c: Point): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

/**
 * The three points of the stroke that enclose the most area.
 *
 * Used instead of corner detection because it is indifferent to where the stroke started and
 * to hand tremor along the edges. The search is seeded from the point farthest from the
 * centroid — one vertex of the largest inscribed triangle is always an extreme point — and then
 * the best partners for it are found directly, which keeps this linear rather than cubic.
 */
function largestTriangle(pts: Point[]): [Point, Point, Point] | null {
  if (pts.length < 3) return null;

  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;

  let a = pts[0];
  let far = -1;
  for (const p of pts) {
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d > far) { far = d; a = p; }
  }

  let b = pts[0];
  far = -1;
  for (const p of pts) {
    const d = dist(a, p);
    if (d > far) { far = d; b = p; }
  }

  let c: Point | null = null;
  let best = -1;
  for (const p of pts) {
    const area = triangleArea(a, b, p);
    if (area > best) { best = area; c = p; }
  }
  if (!c || best <= 0) return null;
  return [a, b, c];
}

/**
 * Classify one freehand stroke.
 *
 * Returns `null` when the stroke is too small, too short, or does not resemble anything
 * confidently — in which case the caller keeps the original ink. Leaving a stroke alone is
 * always safe; converting it wrongly destroys what the teacher drew.
 */
export function recognizeShape(raw: Point[]): RecognizedShape | null {
  if (!raw || raw.length < 4) return null;

  const bounds = boundsOf(raw);
  const diagonal = Math.hypot(bounds.width, bounds.height);
  if (diagonal < MIN_SIZE) return null;

  const pts = resample(raw);
  const closed = isClosed(pts, bounds);

  // --- open strokes: line or arrow ---
  if (!closed) {
    const straight = straightness(pts);

    if (arrowhead(pts) && straight > 0.55) {
      // The tip is the far end of the shaft, not the very last sample — the last samples are
      // the barb of the head, which points back the way it came.
      const shaftEnd = pts[Math.floor(pts.length * 0.72)];
      return {
        kind: "arrow",
        confidence: Math.min(1, straight + 0.15),
        bounds,
        from: pts[0],
        to: shaftEnd,
      };
    }

    if (straight > 0.9) {
      return {
        kind: "line",
        confidence: straight,
        bounds,
        from: pts[0],
        to: pts[pts.length - 1],
      };
    }
    // An open, curved stroke is almost always genuine handwriting or a sketch. Leave it.
    return null;
  }

  // --- closed strokes: ellipse, rectangle or triangle ---
  //
  // The decisive measurement is how much of the bounding box the stroke actually encloses,
  // because that ratio is a property of the shape itself and not of how it was drawn. A
  // rectangle fills its box; an ellipse fills pi/4 of it; a triangle fills half. Corner
  // counting was tried first and is unreliable: the join where the stroke closes sits on top of
  // a corner as often as not, so a square counted three corners and a triangle counted two.
  //
  // It also rejects things that are not shapes at all. A line of Devanagari — a long horizontal
  // bar with letterforms hanging beneath it — starts and ends close enough together to look
  // closed, but encloses almost none of its bounding box, so it stays as handwriting.
  const area = polygonArea(pts);
  const boxArea = bounds.width * bounds.height;
  const fill = boxArea > 0 ? area / boxArea : 0;

  const ellipse = ellipseFit(pts, bounds);
  const rect = rectangleFit(pts, bounds);

  const aspect = bounds.width > 0 && bounds.height > 0
    ? Math.min(bounds.width, bounds.height) / Math.max(bounds.width, bounds.height)
    : 0;
  const nearlyRegular = aspect > 0.86;

  // Rectangle: fills nearly the whole box, and hugs its edges.
  if (fill >= RECT_FILL && rect > 0.62) {
    return {
      kind: "rectangle",
      confidence: Math.min(1, 0.55 + rect * 0.45),
      bounds,
      regular: nearlyRegular,
    };
  }

  // Ellipse: fills about pi/4 of the box, and every point sits at radius ~1 in the box's frame.
  if (fill >= ELLIPSE_FILL && fill < RECT_FILL && ellipse > 0.7) {
    return { kind: "ellipse", confidence: ellipse, bounds, regular: nearlyRegular };
  }

  // Triangle: fills about half. The vertices are recovered by finding the three points that
  // enclose the most area, which does not care where the stroke happened to start.
  if (fill >= TRIANGLE_FILL && fill < ELLIPSE_FILL) {
    const vertices = largestTriangle(pts);
    if (vertices) {
      // Guard against a squashed "triangle" that is really a curve: the recovered vertices
      // should account for most of the area the stroke actually encloses.
      const covered = triangleArea(vertices[0], vertices[1], vertices[2]);
      if (area > 0 && covered / area > 0.75) {
        return {
          kind: "triangle",
          confidence: Math.min(1, 0.6 + (covered / area) * 0.35),
          bounds,
          points: vertices,
        };
      }
    }
  }

  return null;
}

/**
 * Snap a shape to a perfect square or circle when it was drawn nearly regular.
 *
 * Somebody drawing a square almost never gets the sides equal, but they meant them to be.
 * Applied only above the regularity threshold, so a deliberate wide rectangle stays wide.
 */
export function squareUp(shape: RecognizedShape): RecognizedShape {
  if (!shape.regular) return shape;
  if (shape.kind !== "rectangle" && shape.kind !== "ellipse") return shape;

  const size = (shape.bounds.width + shape.bounds.height) / 2;
  return {
    ...shape,
    bounds: {
      x: shape.bounds.x + (shape.bounds.width - size) / 2,
      y: shape.bounds.y + (shape.bounds.height - size) / 2,
      width: size,
      height: size,
    },
  };
}
