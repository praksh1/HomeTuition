import assert from "node:assert/strict";
import test from "node:test";
import { laserVisible, normalizeLaserPoint } from "./whiteboardLaser.ts";

test("laser points are clamped to the board instead of leaking outside it", () => {
  assert.deepEqual(normalizeLaserPoint(-2, 3), { x: 0, y: 1, active: true });
  assert.deepEqual(normalizeLaserPoint(Number.NaN, Number.POSITIVE_INFINITY), { x: 0, y: 0, active: true });
});

test("a laser is visible only until its short expiry", () => {
  const point = normalizeLaserPoint(0.5, 0.5);
  assert.equal(laserVisible(point, 100, 1000), true);
  assert.equal(laserVisible(point, 1000, 1000), false);
  assert.equal(laserVisible({ ...point, active: false }, 100, 1000), false);
});
