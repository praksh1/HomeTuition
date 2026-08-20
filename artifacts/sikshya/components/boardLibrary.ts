/**
 * The teaching shapes that ship with the whiteboard.
 *
 * Excalidraw's Library button opens a browser of community collections hosted on
 * excalidraw.com — flowchart icons, UML, cloud architecture. A tutor in Nepal explaining
 * fractions to a twelve-year-old has no use for any of it, and on a poor connection it often
 * does not load at all. The button now opens a set built for this product: a number line, axes,
 * a fraction bar, place-value columns.
 *
 * They are generated rather than drawn by hand so that adding one is a few lines here rather
 * than a blob of coordinates pasted from somewhere. Every item is ordinary Excalidraw elements
 * once placed — a teacher can pull a number line apart, restyle it, or extend it, and it syncs
 * to students like anything else.
 *
 * **Adding to this is the point.** New items go in `TEACHING_LIBRARY` below; nothing else needs
 * to change. Collections downloaded from excalidraw.com can also be pasted in as items, and a
 * teacher can still add their own through the Library panel, which is saved in their browser.
 */

const INK = "#1e1e1e";

let sequence = 0;
/** Stable within a session and unique across items, which is all Excalidraw asks of an id. */
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}-${Math.random().toString(36).slice(2, 8)}`;
}

interface Base {
  x: number;
  y: number;
  width: number;
  height: number;
}

function element(type: string, base: Base, extra: Record<string, unknown> = {}) {
  return {
    id: nextId(type),
    type,
    x: base.x,
    y: base.y,
    width: base.width,
    height: base.height,
    angle: 0,
    strokeColor: INK,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    // Straight lines, not sketchy ones: a number line drawn with a wobble is harder to read,
    // and these are reference figures rather than illustrations.
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 100000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 100000),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    ...extra,
  };
}

function line(x1: number, y1: number, x2: number, y2: number, extra: Record<string, unknown> = {}) {
  return element(
    "line",
    { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
    { points: [[0, 0], [x2 - x1, y2 - y1]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: null, ...extra },
  );
}

function arrow(x1: number, y1: number, x2: number, y2: number) {
  return element(
    "arrow",
    { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
    { points: [[0, 0], [x2 - x1, y2 - y1]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: "arrow" },
  );
}

function rect(x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}) {
  return element("rectangle", { x, y, width, height }, extra);
}

function label(text: string, x: number, y: number, fontSize = 16) {
  return element(
    "text",
    { x, y, width: Math.max(8, text.length * fontSize * 0.6), height: fontSize * 1.25 },
    {
      text,
      originalText: text,
      fontSize,
      fontFamily: 1,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      lineHeight: 1.25,
      strokeWidth: 1,
    },
  );
}

/** 0 to 10, ticked and numbered — the first thing drawn in half the arithmetic lessons there are. */
function numberLine() {
  const step = 60;
  const elements: unknown[] = [line(0, 0, step * 10, 0)];
  for (let i = 0; i <= 10; i++) {
    const x = i * step;
    elements.push(line(x, -8, x, 8));
    elements.push(label(String(i), x - (i === 10 ? 10 : 5), 14, 15));
  }
  return elements;
}

/** Cartesian axes with arrowheads and an origin label. */
function axes() {
  const span = 200;
  return [
    arrow(-span, 0, span, 0),
    arrow(0, span, 0, -span),
    label("x", span + 8, -10, 16),
    label("y", 8, -span - 20, 16),
    label("0", -18, 6, 14),
  ];
}

/** A bar split into equal parts — fractions, percentages, sharing a quantity. */
function fractionBar(parts: number) {
  const width = 480;
  const height = 70;
  const partWidth = width / parts;
  const elements: unknown[] = [rect(0, 0, width, height)];
  for (let i = 1; i < parts; i++) {
    elements.push(line(i * partWidth, 0, i * partWidth, height));
  }
  for (let i = 0; i < parts; i++) {
    elements.push(label(`1/${parts}`, i * partWidth + partWidth / 2 - 14, height / 2 - 10, 15));
  }
  return elements;
}

/** Hundreds / tens / units, the standard scaffold for written arithmetic. */
function placeValueColumns() {
  const columnWidth = 110;
  const height = 150;
  const headings = ["H", "T", "U"];
  const elements: unknown[] = [];
  headings.forEach((heading, i) => {
    elements.push(rect(i * columnWidth, 0, columnWidth, height));
    elements.push(label(heading, i * columnWidth + columnWidth / 2 - 8, 8, 20));
    elements.push(line(i * columnWidth, 40, (i + 1) * columnWidth, 40));
  });
  return elements;
}

/** A right-angled triangle with the square marking the right angle. */
function rightTriangle() {
  const size = 220;
  const mark = 22;
  return [
    line(0, size, size, size),
    line(0, size, 0, 0),
    line(0, 0, size, size),
    line(0, size - mark, mark, size - mark),
    line(mark, size - mark, mark, size),
  ];
}

/** A circle with its radius drawn and labelled. */
function circleWithRadius() {
  const d = 220;
  return [
    element("ellipse", { x: 0, y: 0, width: d, height: d }),
    line(d / 2, d / 2, d, d / 2),
    label("r", d * 0.72, d / 2 - 24, 16),
  ];
}

function item(name: string, elements: unknown[]) {
  return {
    id: nextId("lib"),
    status: "unpublished" as const,
    created: Date.now(),
    name,
    elements,
  };
}

/**
 * Everything the Library panel offers out of the box. Add to this list to add a shape.
 *
 * Typed loosely at this one boundary on purpose. Excalidraw's element type is a large internal
 * union, and these objects are validated by Excalidraw's own import path when the board loads
 * them — the same treatment the rest of this file's dealings with the editor get.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function teachingLibrary(): any[] {
  return [
    item("Number line 0–10", numberLine()),
    item("Coordinate axes", axes()),
    item("Fraction bar — halves", fractionBar(2)),
    item("Fraction bar — quarters", fractionBar(4)),
    item("Place value H T U", placeValueColumns()),
    item("Right-angled triangle", rightTriangle()),
    item("Circle with radius", circleWithRadius()),
  ];
}
