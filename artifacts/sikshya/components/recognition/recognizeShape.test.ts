/**
 * What the recogniser must get right, and — more importantly — what it must refuse.
 *
 * This module has been described as working since it was written, on the strength of having
 * been tried by hand on a board that no longer exists. It is about to be wired to the board
 * that does exist, so the claims are checked here first. The refusals matter more than the
 * successes: a teacher whose drawing is left alone has lost nothing, and a teacher whose
 * writing is silently turned into a triangle has lost the sentence.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_CONFIDENCE, recognizeShape, squareUp, type Point } from "./recognizeShape.ts";

/**
 * A deterministic wobble, so a failure here is always reproducible.
 *
 * Real strokes are never clean, and a recogniser tested only on perfect input tells you
 * nothing about the finger of someone drawing on a bus.
 */
function wobbler(seed: number): (amount: number) => number {
  let state = seed;
  return (amount: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return ((state / 2147483648) * 2 - 1) * amount;
  };
}

function circle(cx: number, cy: number, rx: number, ry: number, wobble = 0, seed = 7): Point[] {
  const w = wobbler(seed);
  const pts: Point[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx + w(wobble), y: cy + Math.sin(a) * ry + w(wobble) });
  }
  return pts;
}

function polygon(corners: Point[], perEdge = 14, wobble = 0, seed = 11): Point[] {
  const w = wobbler(seed);
  const pts: Point[] = [];
  for (let c = 0; c < corners.length; c++) {
    const a = corners[c];
    const b = corners[(c + 1) % corners.length];
    for (let i = 0; i < perEdge; i++) {
      const t = i / perEdge;
      pts.push({ x: a.x + (b.x - a.x) * t + w(wobble), y: a.y + (b.y - a.y) * t + w(wobble) });
    }
  }
  pts.push({ ...corners[0] });
  return pts;
}

function segment(from: Point, to: Point, n = 24, wobble = 0, seed = 3): Point[] {
  const w = wobbler(seed);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return { x: from.x + (to.x - from.x) * t + w(wobble), y: from.y + (to.y - from.y) * t + w(wobble) };
  });
}

// --- the shapes it should find -------------------------------------------------------------

test("a rough circle becomes an ellipse", () => {
  const shape = recognizeShape(circle(200, 200, 90, 90, 4));
  assert.equal(shape?.kind, "ellipse");
  assert.ok((shape?.confidence ?? 0) >= MIN_CONFIDENCE);
});

test("a wide oval stays an oval rather than being rounded to a circle", () => {
  const shape = recognizeShape(circle(200, 200, 140, 50, 3));
  assert.equal(shape?.kind, "ellipse");
  assert.equal(shape?.regular, false, "a deliberately wide oval is not a circle");
  assert.deepEqual(squareUp(shape!), shape, "and squareUp leaves it alone");
});

test("a lumpy box becomes a rectangle", () => {
  const box = polygon(
    [{ x: 60, y: 60 }, { x: 300, y: 60 }, { x: 300, y: 220 }, { x: 60, y: 220 }],
    16,
    5,
  );
  const shape = recognizeShape(box);
  assert.equal(shape?.kind, "rectangle");
  assert.ok((shape?.confidence ?? 0) >= MIN_CONFIDENCE);
});

test("a sketched triangle becomes a triangle, with its corners recovered", () => {
  const tri = polygon([{ x: 200, y: 40 }, { x: 340, y: 260 }, { x: 60, y: 260 }], 18, 4);
  const shape = recognizeShape(tri);
  assert.equal(shape?.kind, "triangle");
  assert.equal(shape?.points?.length, 3);
});

test("a dashed-off line straightens", () => {
  const shape = recognizeShape(segment({ x: 40, y: 120 }, { x: 380, y: 150 }, 30, 3));
  assert.equal(shape?.kind, "line");
  assert.ok((shape?.confidence ?? 0) >= MIN_CONFIDENCE);
});

test("a line with a barb becomes an arrow that points the way it was drawn", () => {
  const shaft = segment({ x: 40, y: 200 }, { x: 320, y: 200 }, 26, 2);
  // The head: back up and away from the tip, the way a barb is actually drawn.
  const barb = segment({ x: 320, y: 200 }, { x: 280, y: 170 }, 8, 1);
  const shape = recognizeShape([...shaft, ...barb]);
  assert.equal(shape?.kind, "arrow");
  assert.ok((shape?.to?.x ?? 0) > (shape?.from?.x ?? 0), "it points right, as it was drawn");
});

// --- what it must refuse -------------------------------------------------------------------

test("handwriting is left alone", () => {
  // An open, curved stroke: the shape of a written word, not a drawn figure.
  const script: Point[] = [];
  for (let i = 0; i <= 60; i++) {
    const x = 40 + i * 4;
    script.push({ x, y: 150 + Math.sin(i / 3) * 22 });
  }
  assert.equal(recognizeShape(script), null);
});

test("a line of Devanagari is not turned into a triangle", () => {
  // The regression this module was corrected for: the horizontal bar across the top of a
  // Devanagari line, with letterforms hanging beneath, starts and ends close enough together
  // to look like a closed stroke while enclosing almost none of its bounding box.
  const pts: Point[] = [];
  for (let x = 40; x <= 340; x += 6) pts.push({ x, y: 100 });          // the shirorekha
  for (let i = 0; i < 6; i++) {                                        // letterforms below it
    const base = 320 - i * 50;
    for (let k = 0; k <= 8; k++) pts.push({ x: base - k * 2, y: 100 + k * 5 });
    for (let k = 8; k >= 0; k--) pts.push({ x: base - 16 - k * 2, y: 100 + k * 5 });
  }
  pts.push({ x: 42, y: 102 });                                         // ending near the start
  assert.equal(recognizeShape(pts), null);
});

test("a tap is not a tiny circle", () => {
  assert.equal(recognizeShape(circle(100, 100, 3, 3)), null);
  assert.equal(recognizeShape([{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 5, y: 6 }]), null);
});

test("too few points is not a shape", () => {
  assert.equal(recognizeShape([]), null);
  assert.equal(recognizeShape([{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 90, y: 10 }]), null);
});

test("a wild scribble is not forced into anything", () => {
  const w = wobbler(99);
  const scribble = Array.from({ length: 80 }, (_, i) => ({
    x: 150 + Math.cos(i) * 70 + w(40),
    y: 150 + Math.sin(i * 1.7) * 70 + w(40),
  }));
  const shape = recognizeShape(scribble);
  // Either refused outright, or held below the threshold the caller checks. Both keep the ink.
  assert.ok(shape === null || shape.confidence < MIN_CONFIDENCE, `got ${shape?.kind}`);
});

// --- squaring up ---------------------------------------------------------------------------

test("a nearly-square box is squared up; a deliberately oblong one is not", () => {
  const near = recognizeShape(
    polygon([{ x: 50, y: 50 }, { x: 250, y: 50 }, { x: 250, y: 236 }, { x: 50, y: 236 }], 16, 4),
  );
  assert.equal(near?.kind, "rectangle");
  assert.equal(near?.regular, true);
  const snapped = squareUp(near!);
  assert.equal(snapped.bounds.width, snapped.bounds.height, "sides equal after squaring up");

  const oblong = recognizeShape(
    polygon([{ x: 50, y: 50 }, { x: 400, y: 50 }, { x: 400, y: 140 }, { x: 50, y: 140 }], 16, 4),
  );
  assert.equal(oblong?.regular, false);
  assert.deepEqual(squareUp(oblong!), oblong, "a wide rectangle stays wide");
});

// --- the arrow and the wave, across a range, because one example of each proves little -------

test("arrows are found whichever way they are drawn", () => {
  // Tip, and the direction the barb folds back to. A barb is drawn back from the tip, so the
  // stroke ends behind it — that is what tells the recogniser which end is the point.
  const cases: Array<[string, Point, Point, Point]> = [
    ["right", { x: 40, y: 200 }, { x: 320, y: 200 }, { x: 280, y: 172 }],
    ["left", { x: 340, y: 120 }, { x: 60, y: 120 }, { x: 100, y: 148 }],
    ["up", { x: 150, y: 340 }, { x: 150, y: 60 }, { x: 122, y: 100 }],
    ["down-right", { x: 60, y: 60 }, { x: 300, y: 260 }, { x: 268, y: 226 }],
  ];
  for (const [name, tail, tip, barbEnd] of cases) {
    const stroke = [...segment(tail, tip, 26, 2), ...segment(tip, barbEnd, 8, 1)];
    const shape = recognizeShape(stroke);
    assert.equal(shape?.kind, "arrow", `an arrow drawn ${name}`);
    assert.ok((shape?.confidence ?? 0) >= MIN_CONFIDENCE, `confident about the ${name} arrow`);
  }
});

test("a barb drawn small is still an arrow; no barb at all is still a line", () => {
  const tail = { x: 40, y: 200 };
  const tip = { x: 320, y: 200 };
  const small = [...segment(tail, tip, 26, 1), ...segment(tip, { x: 297, y: 184 }, 6, 0.5)];
  assert.equal(recognizeShape(small)?.kind, "arrow", "a short barb");
  assert.equal(recognizeShape(segment(tail, tip, 30, 2))?.kind, "line", "no barb");
});

test("writing is left alone, and a wobbly line is straightened", () => {
  const wave = (period: number, amplitude: number) =>
    Array.from({ length: 61 }, (_, i) => ({
      x: 40 + i * 4,
      y: 150 + Math.sin(i / period) * amplitude,
    }));

  // Writing proper: the stroke climbs and falls steeply enough to leave its own direction.
  // The threshold that finds an arrow's barb must not find one in any of these.
  const writing = [[2, 12], [2, 34], [3, 12], [3, 34], [4, 12], [4, 34], [6, 22], [6, 34], [9, 34]];
  for (const [period, amplitude] of writing) {
    const shape = recognizeShape(wave(period, amplitude));
    assert.ok(
      shape === null || shape.confidence < MIN_CONFIDENCE,
      `writing at period ${period}, amplitude ${amplitude} became ${shape?.kind}`,
    );
  }

  // Below that the stroke is not writing at all — it is a line somebody drew unsteadily, never
  // more than 12px off true across 240 — and straightening it is the feature working rather
  // than a mistake. Asserted rather than left implicit, so moving this boundary in *either*
  // direction shows up here: replacing writing, or refusing to help with a shaky line.
  assert.equal(recognizeShape(wave(9, 12))?.kind, "line", "a barely-wobbling stroke");
  assert.equal(recognizeShape(wave(6, 12))?.kind, "line");
});
