/**
 * Classroom eraser policy.
 *
 * A document or diagram is the lesson's paper, not ink. Excalidraw's eraser normally deletes
 * every object it crosses, including a PDF page underneath handwriting. In Fadko the eraser is
 * intentionally narrower: it removes handwriting and typed text. Pictures and constructed
 * shapes stay until the teacher selects them and explicitly presses Delete.
 */
export interface BoardEraserElement {
  id: string;
  type?: string;
  version: number;
  versionNonce?: number;
  updated?: number;
  isDeleted?: boolean;
  [key: string]: unknown;
}

export interface BoardEraserResult<T extends BoardEraserElement> {
  elements: T[];
  protectedCount: number;
}

export function eraserMayDelete(element: BoardEraserElement): boolean {
  return element.type === "freedraw" || element.type === "text";
}

export function protectBoardElementsFromEraser<T extends BoardEraserElement>(
  current: readonly T[],
  beforeGesture: ReadonlyMap<string, T>,
  now = Date.now(),
): BoardEraserResult<T> {
  let protectedCount = 0;

  const elements = current.map((element) => {
    if (!element.isDeleted || eraserMayDelete(element)) return element;

    const previous = beforeGesture.get(element.id);
    if (!previous || previous.isDeleted) return element;

    protectedCount += 1;
    return {
      ...previous,
      isDeleted: false,
      version: Math.max(previous.version, element.version) + 1,
      versionNonce: (previous.versionNonce ?? 0) + 1,
      updated: now,
    } as T;
  });

  return { elements, protectedCount };
}

export function rememberVisibleBoardElements<T extends BoardEraserElement>(
  target: Map<string, T>,
  elements: readonly T[],
): void {
  for (const element of elements) {
    if (element.isDeleted) target.delete(element.id);
    else target.set(element.id, element);
  }
}
