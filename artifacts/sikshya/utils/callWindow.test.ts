import assert from "node:assert/strict";
import { test } from "node:test";
import {
  callWindowControls,
  callWindowReducer,
  clampOffset,
  compactSize,
  dragBounds,
  initialCallWindow,
  normalSize,
  windowRect,
  type CallWindowAction,
  type CallWindowModel,
  type Viewport,
} from "./callWindow.ts";

/**
 * The window both classrooms show, checked without either of them.
 *
 * The owner's complaint was that the minus button did nothing. It toggled between two sizes a
 * finger apart and left the window wherever it had been dragged, which from the outside is a
 * dead control. Most of what follows is that one behaviour, pinned.
 */

const PHONE: Viewport = {
  width: 360, height: 740,
  insets: { top: 44, bottom: 34, left: 0, right: 0 },
  reservedTop: 44, reservedBottom: 88, hitSlopMin: 44,
};
const LAPTOP: Viewport = {
  width: 1280, height: 800,
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
  reservedTop: 44, reservedBottom: 88, hitSlopMin: 44,
};

const run = (actions: CallWindowAction[], from: CallWindowModel = initialCallWindow()) =>
  actions.reduce(callWindowReducer, from);

test("a call starts as a small preview, parked", () => {
  const m = initialCallWindow();
  assert.equal(m.state, "compact");
  assert.deepEqual(m.offset, { x: 0, y: 0 });
});

test("minus from normal always lands on compact, in the corner", () => {
  const m = run([{ type: "toggle-full" }, { type: "toggle-full" }, { type: "drag", dx: -120, dy: -200 }]);
  const minimized = callWindowReducer({ ...m, state: "normal" }, { type: "minimize" });
  assert.equal(minimized.state, "compact");
  assert.deepEqual(minimized.offset, { x: 0, y: 0 }, "and back where it can be found");
});

test("minus from full lands on compact too, not on the last windowed size", () => {
  /**
   * The old control toggled small/medium and did nothing at all from full. Minus now means one
   * thing everywhere: make it small and put it back.
   */
  const full = run([{ type: "toggle-full" }]);
  assert.equal(full.state, "full");
  const minimized = callWindowReducer(full, { type: "minimize" });
  assert.equal(minimized.state, "compact");
  assert.deepEqual(minimized.offset, { x: 0, y: 0 });
});

test("minus on a window that has been dragged brings it home", () => {
  const dragged = run([{ type: "drag", dx: -90, dy: -140 }]);
  assert.notDeepEqual(dragged.offset, { x: 0, y: 0 });
  assert.deepEqual(callWindowReducer(dragged, { type: "minimize" }).offset, { x: 0, y: 0 });
});

test("minus on an already-parked compact window is the one time it does nothing", () => {
  const parked = initialCallWindow();
  assert.equal(callWindowReducer(parked, { type: "minimize" }), parked, "same object, no re-render");
  // And the button says so rather than pretending.
  assert.equal(callWindowControls(parked).canMinimize, false);
  assert.equal(callWindowControls(run([{ type: "drag", dx: -10, dy: -10 }])).canMinimize, true);
});

test("hide and show are separate from minimise, and show restores what was hidden", () => {
  for (const state of ["compact", "normal", "full"] as const) {
    const before =
      state === "compact" ? initialCallWindow()
      : state === "normal" ? { ...initialCallWindow(), state: "normal" as const }
      : run([{ type: "toggle-full" }]);
    const hidden = callWindowReducer(before, { type: "hide" });
    assert.equal(hidden.state, "hidden", state);
    const shown = callWindowReducer(hidden, { type: "show" });
    assert.equal(shown.state, state, `show restores ${state}`);
  }
});

test("show always shows something", () => {
  // `lastVisible` can never be hidden, so Show can never be a no-op the person has to press twice.
  const hidden = run([{ type: "hide" }]);
  assert.notEqual(callWindowReducer(hidden, { type: "show" }).state, "hidden");
});

test("hiding a full-screen call brings back a full-screen call", () => {
  const m = run([{ type: "toggle-full" }, { type: "hide" }, { type: "show" }]);
  assert.equal(m.state, "full");
});

test("maximise toggles between full and the windowed size that was last used", () => {
  const fromNormal = run([{ type: "toggle-full" }], { ...initialCallWindow(), state: "normal", lastWindowed: "normal" });
  assert.equal(fromNormal.state, "full");
  assert.equal(callWindowReducer(fromNormal, { type: "toggle-full" }).state, "normal");

  const fromCompact = run([{ type: "toggle-full" }]);
  assert.equal(callWindowReducer(fromCompact, { type: "toggle-full" }).state, "compact");
});

test("a hidden window is not dragged, and neither is a full one", () => {
  const hidden = run([{ type: "hide" }, { type: "drag", dx: 50, dy: 50 }]);
  assert.deepEqual(hidden.offset, { x: 0, y: 0 });
  const full = run([{ type: "toggle-full" }, { type: "drag", dx: 50, dy: 50 }]);
  assert.deepEqual(full.offset, { x: 0, y: 0 }, "full is pinned to the safe area");
});

/* ---------------------------------------------------------------------------
 * Geometry
 * ------------------------------------------------------------------------- */

test("compact leaves room for the one control it offers", () => {
  for (const v of [PHONE, LAPTOP]) {
    const size = compactSize(v);
    // The header carries Restore and must be a real tap target, not a sliver.
    assert.ok(size.height - (size.width * 9) / 16 >= v.hitSlopMin - 1, JSON.stringify(size));
  }
});

test("compact does not offer a provider control row it cannot fit", () => {
  assert.equal(callWindowControls(initialCallWindow()).showsProviderControls, false);
  assert.equal(
    callWindowControls({ ...initialCallWindow(), state: "normal" }).showsProviderControls, true);
  assert.equal(callWindowControls(run([{ type: "toggle-full" }])).showsProviderControls, true);
});

test("normal is big enough to work a provider's own controls", () => {
  for (const v of [PHONE, LAPTOP]) {
    assert.ok(normalSize(v).width >= 280 || normalSize(v).width >= v.width - 16, JSON.stringify(normalSize(v)));
    assert.ok(normalSize(v).width > compactSize(v).width, "and bigger than the preview");
  }
});

test("full fills the safe area and nothing more", () => {
  const rect = windowRect("full", PHONE);
  assert.equal(rect.top, PHONE.insets.top);
  assert.equal(rect.height, PHONE.height - PHONE.insets.top - PHONE.insets.bottom);
  assert.ok(rect.top + rect.height <= PHONE.height - PHONE.insets.bottom, "never under the home bar");
});

test("a parked window sits in the bottom-right, clear of the board's own controls", () => {
  for (const v of [PHONE, LAPTOP]) {
    const rect = windowRect("compact", v);
    const b = dragBounds("compact", v);
    assert.ok(rect.left >= b.minX - 0.5 && rect.left <= b.maxX + 0.5, "inside horizontally");
    assert.ok(rect.top >= b.minY - 0.5 && rect.top <= b.maxY + 0.5, "inside vertically");
    // Bottom-right means near the right edge and above the board's bottom controls.
    assert.ok(rect.left + rect.width <= v.width - v.insets.right, "not off the right edge");
    assert.ok(rect.top + rect.height <= v.height - v.insets.bottom - v.reservedBottom + 8,
      "clear of the board's bottom row");
  }
});

test("the window can never be dragged off the screen", () => {
  for (const v of [PHONE, LAPTOP]) {
    for (const drag of [{ dx: -9999, dy: -9999 }, { dx: 9999, dy: 9999 }]) {
      const m = run([{ type: "drag", ...drag }]);
      const rect = windowRect("compact", v, m.offset);
      assert.ok(rect.left >= 0, `left ${rect.left}`);
      assert.ok(rect.top >= v.insets.top, `top ${rect.top}`);
      assert.ok(rect.left + rect.width <= v.width + 0.5, `right ${rect.left + rect.width}`);
      assert.ok(rect.top + rect.height <= v.height + 0.5, `bottom ${rect.top + rect.height}`);
    }
  }
});

test("rotating the screen re-clamps the window instead of losing it", () => {
  const landscape: Viewport = { ...PHONE, width: 740, height: 360 };
  // Dragged far left in portrait, then the phone turns.
  const dragged = run([{ type: "drag", dx: -300, dy: -400 }]);
  const rotated = callWindowReducer(dragged, { type: "viewport", bounds: dragBounds("compact", landscape) });
  const rect = windowRect("compact", landscape, rotated.offset);
  assert.ok(rect.left >= 0 && rect.top >= landscape.insets.top, JSON.stringify(rect));
  assert.ok(rect.left + rect.width <= landscape.width + 0.5, JSON.stringify(rect));
  assert.ok(rect.top + rect.height <= landscape.height + 0.5, JSON.stringify(rect));
});

test("a resize does not throw the window back to the corner", () => {
  // Re-clamping is not resetting. Somebody who moved their window keeps it where they can.
  const dragged = run([{ type: "drag", dx: -20, dy: -30 }]);
  const resized = callWindowReducer(dragged, { type: "viewport", bounds: dragBounds("compact", LAPTOP) });
  assert.deepEqual(resized.offset, { x: -20, y: -30 });
});

test("clamping an offset never pushes a window past its own dock", () => {
  const b = dragBounds("compact", PHONE);
  assert.deepEqual(clampOffset({ x: 500, y: 500 }, b), { x: 0, y: 0 }, "the dock is the far corner");
  const pulled = clampOffset({ x: -99999, y: -99999 }, b);
  assert.equal(pulled.x, -(b.maxX - b.minX));
  assert.equal(pulled.y, -(b.maxY - b.minY));
});

test("a hidden window takes no touches, and every visible one does", () => {
  assert.equal(callWindowControls(run([{ type: "hide" }])).interactive, false);
  for (const state of ["compact", "normal", "full"] as const) {
    assert.equal(callWindowControls({ ...initialCallWindow(), state }).interactive, true, state);
  }
});

test("hide is offered only when there is something to hide, and show only when there is not", () => {
  const visible = callWindowControls(initialCallWindow());
  assert.equal(visible.canHide, true);
  assert.equal(visible.canShow, false);
  const hidden = callWindowControls(run([{ type: "hide" }]));
  assert.equal(hidden.canHide, false);
  assert.equal(hidden.canShow, true);
  assert.equal(hidden.canDrag, false, "nothing to drag");
});

test("nothing in the model can put the call into a state that would remount it", () => {
  /**
   * The state machine has no "off". Hiding, minimising, maximising, dragging and rotating all
   * move a mounted window; none of them can produce a model where the call is absent — which is
   * the guarantee the classroom relies on to keep Daily alive through all of it.
   */
  const every: CallWindowAction[] = [
    { type: "hide" }, { type: "show" }, { type: "minimize" }, { type: "toggle-full" },
    { type: "drag", dx: 10, dy: 10 }, { type: "viewport", bounds: dragBounds("compact", PHONE) },
  ];
  let m = initialCallWindow();
  for (let i = 0; i < 40; i += 1) {
    m = callWindowReducer(m, every[i % every.length]);
    assert.ok(["hidden", "compact", "normal", "full"].includes(m.state));
    assert.notEqual(m.lastVisible, "hidden", "there is always something to come back to");
    assert.ok(m.lastWindowed === "compact" || m.lastWindowed === "normal");
  }
});

test("Restore on a compact window gives back the working size, not full screen", () => {
  // A thumbnail's Restore means "give me the window back". Full screen would bury the board.
  const restored = callWindowReducer(initialCallWindow(), { type: "restore" });
  assert.equal(restored.state, "normal");
  assert.equal(restored.lastWindowed, "normal", "and maximise now comes back to it");
});

test("Restore then maximise then maximise lands back on normal", () => {
  const m = run([{ type: "restore" }, { type: "toggle-full" }, { type: "toggle-full" }]);
  assert.equal(m.state, "normal");
});
