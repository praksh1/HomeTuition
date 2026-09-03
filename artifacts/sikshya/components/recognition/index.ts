/**
 * Dormant geometric-recognition research code.
 *
 * This module is intentionally not imported by the classroom board. A real teacher test found
 * false corrections in ordinary handwriting, so freehand now stays ink. The pure implementation
 * and its isolated tests remain available for future experiments without shipping an automatic
 * conversion path to teachers.
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
