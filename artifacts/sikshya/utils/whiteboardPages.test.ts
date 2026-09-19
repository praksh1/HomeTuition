import assert from "node:assert/strict";
import test from "node:test";
import {
  activeWhiteboardPage,
  applyWhiteboardPageAction,
  initialWhiteboardPages,
  nextWhiteboardPage,
  normalizeWhiteboardPages,
  previousWhiteboardPage,
} from "./whiteboardPages.ts";

test("a new board starts with one named blank page", () => {
  const state = initialWhiteboardPages();
  assert.deepEqual(state.pages, [{ id: "page-1", title: "Page 1", template: "blank", locked: false }]);
  assert.equal(activeWhiteboardPage(state).id, "page-1");
});

test("adding a page selects it and preserves its template", () => {
  const next = applyWhiteboardPageAction(initialWhiteboardPages(), {
    type: "add",
    id: "page-2",
    title: "Algebra",
    template: "coordinate",
  });
  assert.equal(next.activePageId, "page-2");
  assert.deepEqual(next.pages[1], { id: "page-2", title: "Algebra", template: "coordinate", locked: false });
});

test("duplicate inserts beside the source and never carries a locked flag", () => {
  let state = applyWhiteboardPageAction(initialWhiteboardPages(), { type: "lock", id: "page-1", locked: true });
  state = applyWhiteboardPageAction(state, { type: "duplicate", id: "page-1", newId: "page-2" });
  assert.equal(state.pages[1].title, "Page 1 copy");
  assert.equal(state.pages[1].locked, false);
  assert.equal(state.activePageId, "page-2");
});

test("rename, template and lock are bounded to an existing page", () => {
  let state = initialWhiteboardPages();
  state = applyWhiteboardPageAction(state, { type: "rename", id: "page-1", title: "  Quadratic equations  " });
  state = applyWhiteboardPageAction(state, { type: "template", id: "page-1", template: "math-grid" });
  state = applyWhiteboardPageAction(state, { type: "lock", id: "page-1", locked: true });
  assert.deepEqual(state.pages[0], { id: "page-1", title: "Quadratic equations", template: "math-grid", locked: true });
  assert.deepEqual(applyWhiteboardPageAction(state, { type: "rename", id: "missing", title: "Nope" }), state);
});

test("deleting the active page selects the previous page and never deletes the last page", () => {
  let state = initialWhiteboardPages();
  state = applyWhiteboardPageAction(state, { type: "add", id: "page-2" });
  state = applyWhiteboardPageAction(state, { type: "add", id: "page-3" });
  state = applyWhiteboardPageAction(state, { type: "delete", id: "page-3" });
  assert.equal(state.activePageId, "page-2");
  state = applyWhiteboardPageAction(state, { type: "delete", id: "page-2" });
  state = applyWhiteboardPageAction(state, { type: "delete", id: "page-1" });
  assert.equal(state.pages.length, 1);
});

test("reorder changes only ordering and selection moves by explicit action", () => {
  let state = initialWhiteboardPages();
  state = applyWhiteboardPageAction(state, { type: "add", id: "page-2" });
  state = applyWhiteboardPageAction(state, { type: "add", id: "page-3" });
  state = applyWhiteboardPageAction(state, { type: "reorder", id: "page-3", toIndex: 0 });
  assert.deepEqual(state.pages.map((page) => page.id), ["page-3", "page-1", "page-2"]);
  assert.equal(state.activePageId, "page-3");
  state = applyWhiteboardPageAction(state, { type: "select", id: "page-1" });
  assert.equal(state.activePageId, "page-1");
  assert.equal(previousWhiteboardPage(state).id, "page-3");
  assert.equal(nextWhiteboardPage(state).id, "page-2");
});

test("malformed persisted metadata cannot create duplicate or invalid pages", () => {
  const state = normalizeWhiteboardPages({
    pages: [
      { id: "same", title: "  One  ", template: "not-a-template" },
      { id: "same", title: "Two", template: "lined", locked: true },
      null,
    ],
    activePageId: "missing",
  });
  assert.deepEqual(state.pages, [{ id: "same", title: "One", template: "blank", locked: false }]);
  assert.equal(state.activePageId, "same");
});
