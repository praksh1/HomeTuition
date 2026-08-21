import assert from "node:assert/strict";
import { test } from "node:test";
import { absolutePoints, skeletonFor, type FreehandElement } from "./toExcalidraw.ts";
import type { RecognizedShape } from "./recognizeShape.ts";

const ink: FreehandElement = {
  x: 100,
  y: 50,
  points: [[0, 0], [10, 10], [20, 0]],
  strokeColor: "#e03131",
  strokeWidth: 4,
  opacity: 80,
  roughness: 1,
};

const bounds = { x: 100, y: 50, width: 80, height: 60 };

test("freehand points are lifted into board coordinates", () => {
  assert.deepEqual(absolutePoints(ink), [
    { x: 100, y: 50 },
    { x: 110, y: 60 },
    { x: 120, y: 50 },
  ]);
});

test("points the board could not have meant are dropped rather than passed on", () => {
  const broken: FreehandElement = {
    x: 0,
    y: 0,
    points: [[0, 0], [NaN, 5], [10, Infinity], [7], [20, 20]],
  };
  assert.deepEqual(absolutePoints(broken), [{ x: 0, y: 0 }, { x: 20, y: 20 }]);
});

test("a box and an oval become a rectangle and an ellipse over the same bounds", () => {
  for (const kind of ["rectangle", "ellipse"] as const) {
    const skeleton = skeletonFor({ kind, confidence: 0.9, bounds }, ink);
    assert.equal(skeleton?.type, kind);
    assert.deepEqual(
      { x: skeleton?.x, y: skeleton?.y, width: skeleton?.width, height: skeleton?.height },
      bounds,
    );
  }
});

test("a line and an arrow start where the stroke started", () => {
  const shape: RecognizedShape = {
    kind: "arrow",
    confidence: 0.9,
    bounds,
    from: { x: 100, y: 50 },
    to: { x: 180, y: 110 },
  };
  const skeleton = skeletonFor(shape, ink);
  assert.equal(skeleton?.type, "arrow");
  assert.equal(skeleton?.x, 100);
  assert.equal(skeleton?.y, 50);
  // Excalidraw draws a line's points relative to its own origin, so the first is always [0,0]
  // and the second is the offset. Getting this wrong puts the arrow at twice its distance.
  assert.deepEqual(skeleton?.points, [[0, 0], [80, 60]]);
});

test("a triangle is closed, or it looks like a mistake rather than a tidy-up", () => {
  const shape: RecognizedShape = {
    kind: "triangle",
    confidence: 0.9,
    bounds,
    points: [{ x: 140, y: 50 }, { x: 180, y: 110 }, { x: 100, y: 110 }],
  };
  const skeleton = skeletonFor(shape, ink);
  assert.equal(skeleton?.type, "line");
  assert.deepEqual(skeleton?.points, [[0, 0], [40, 60], [-40, 60], [0, 0]]);
  const pts = skeleton?.points as number[][];
  assert.deepEqual(pts[0], pts[pts.length - 1], "it ends where it began");
});

test("the shape keeps the pen the teacher was drawing with", () => {
  const skeleton = skeletonFor({ kind: "rectangle", confidence: 0.9, bounds }, ink);
  assert.equal(skeleton?.strokeColor, "#e03131");
  assert.equal(skeleton?.strokeWidth, 4);
  assert.equal(skeleton?.opacity, 80);
  assert.equal(skeleton?.roughness, 1);
});

test("style the stroke did not carry is left for the board to decide", () => {
  // Passing `undefined` through would override Excalidraw's own defaults with nothing.
  const bare: FreehandElement = { x: 0, y: 0, points: [[0, 0]] };
  const skeleton = skeletonFor({ kind: "ellipse", confidence: 0.9, bounds }, bare);
  assert.ok(skeleton && !("strokeColor" in skeleton), "no empty strokeColor");
  assert.ok(skeleton && !("opacity" in skeleton), "no empty opacity");
});

test("an incomplete shape leaves the ink alone", () => {
  assert.equal(skeletonFor({ kind: "arrow", confidence: 1, bounds }, ink), null, "no endpoints");
  assert.equal(skeletonFor({ kind: "line", confidence: 1, bounds, from: { x: 0, y: 0 } }, ink), null);
  assert.equal(
    skeletonFor({ kind: "triangle", confidence: 1, bounds, points: [{ x: 0, y: 0 }] }, ink),
    null,
    "a triangle with one corner",
  );
});
