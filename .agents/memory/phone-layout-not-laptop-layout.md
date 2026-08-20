---
name: The board must be tested at phone width, not laptop width
description: Custom controls added to Excalidraw's toolbar row pushed the Selection tool off the left edge of an iPhone screen; the board looked perfect on a laptop and was unusable on a phone.
---

Two buttons were added to the board's toolbar row (Styles and Clear) via `renderTopRightUI`.
On a laptop they sit neatly beside the editor's own tools. On a phone they are 70px added to a
373px toolbar inside a 393px screen, and because the row is **centred**, the overflow is split
between both sides: the **Selection tool ended up at x = -23**, entirely off screen.

A teacher on an iPhone therefore could not select, move or resize anything they had drawn —
most of the point of an object board — and nothing about it looked broken. It looked like the
toolbar simply started at the rectangle tool.

**How to apply:**

- Anything added to `renderTopRightUI` shares a row with the editor's own toolbar. Before
  adding to it, check the width at 360px, not just that it looks right on the machine you are
  working on.
- Excalidraw's phone layout already carries the things worth duplicating: "Clear board for
  everyone" is in the hamburger menu and the style sheet opens from the palette in the bottom
  bar. `.excalidraw--mobile` is the hook for hiding laptop-only controls, and it tracks the
  editor's own breakpoint rather than a second guess at one.
- `artifacts/sikshya/scripts/phone-tests` runs the real board at three phone widths and fails
  if any tool lands off screen. It is in CI. Run it before touching board chrome.
- The same lesson applies to anything overlaid on the video call: the in-call Chat button was
  placed top-right because Daily keeps its controls along the bottom *on a laptop*. On a phone
  it landed on top of Daily's own Leave button. Overlaying a third-party UI means guessing at
  its layout; reserving a strip of your own does not.
