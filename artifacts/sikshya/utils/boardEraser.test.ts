import assert from "node:assert/strict";
import test from "node:test";

import {
  eraserMayDelete,
  protectBoardElementsFromEraser,
  rememberVisibleBoardElements,
  type BoardEraserElement,
} from "./boardEraser.ts";

function element(id: string, type: string, version = 1): BoardEraserElement {
  return { id, type, version, isDeleted: false };
}

test("eraser removes only handwriting and text", () => {
  assert.equal(eraserMayDelete(element("pen", "freedraw")), true);
  assert.equal(eraserMayDelete(element("words", "text")), true);
  assert.equal(eraserMayDelete(element("pdf", "image")), false);
  assert.equal(eraserMayDelete(element("box", "rectangle")), false);
  assert.equal(eraserMayDelete(element("arrow", "arrow")), false);
});

test("an eraser restores documents and shapes but keeps ink deletions", () => {
  const picture = element("pdf", "image", 3);
  const box = element("box", "rectangle", 4);
  const ink = element("ink", "freedraw", 7);
  const before = new Map([
    [picture.id, picture],
    [box.id, box],
    [ink.id, ink],
  ]);

  const result = protectBoardElementsFromEraser(
    [
      { ...picture, version: 4, isDeleted: true },
      { ...box, version: 5, isDeleted: true },
      { ...ink, version: 8, isDeleted: true },
    ],
    before,
    100,
  );

  assert.equal(result.protectedCount, 2);
  assert.deepEqual(
    result.elements.map(({ id, isDeleted, version }) => ({ id, isDeleted, version })),
    [
      { id: "pdf", isDeleted: false, version: 5 },
      { id: "box", isDeleted: false, version: 6 },
      { id: "ink", isDeleted: true, version: 8 },
    ],
  );
});

test("explicit selection deletion remains deleted", () => {
  const remembered = new Map<string, BoardEraserElement>();
  const picture = element("pdf", "image");
  rememberVisibleBoardElements(remembered, [picture]);
  rememberVisibleBoardElements(remembered, [{ ...picture, version: 2, isDeleted: true }]);
  assert.equal(remembered.has("pdf"), false);
});
