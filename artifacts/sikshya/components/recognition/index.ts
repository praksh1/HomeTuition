/**
 * The smart board's recognition layer.
 *
 * Kept as its own module, separate from the drawing surface, for one reason: the drawing engine
 * is going to be replaced (see WHITEBOARD.md), and recognition is the part that has to survive
 * that change. It takes points in and returns shapes; it knows nothing about SVG, React, the
 * websocket protocol or which engine is rendering. Whatever draws the board next can call it
 * unchanged.
 */

export {
  recognizeShape,
  squareUp,
  MIN_CONFIDENCE,
  type Point,
  type RecognizedShape,
  type RecognizedKind,
} from "./recognizeShape";

export { toDrawPath } from "./toDrawPath";
