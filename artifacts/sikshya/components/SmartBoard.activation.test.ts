import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const smartBoardSource = readFileSync(path.join(here, "SmartBoard.web.tsx"), "utf8");

test("the active whiteboard does not automatically convert freehand ink", () => {
  assert.doesNotMatch(smartBoardSource, /from\s+["']\.\/recognition\//);
  assert.doesNotMatch(smartBoardSource, /\brecognizeShape\s*\(/);
  assert.doesNotMatch(smartBoardSource, /\btidyFreehand\s*\(/);
  assert.doesNotMatch(smartBoardSource, /\bconsideredStrokes\b/);
  assert.doesNotMatch(smartBoardSource, /\bconvertToExcalidrawElements\s*\(/);
  assert.doesNotMatch(smartBoardSource, /\b(?:absolutePoints|skeletonFor|squareUp|MIN_CONFIDENCE)\b/);
});

test("the isolated recognizer remains available for future research", () => {
  assert.match(
    readFileSync(path.join(here, "recognition", "recognizeShape.ts"), "utf8"),
    /export function recognizeShape\s*\(/,
  );
});
