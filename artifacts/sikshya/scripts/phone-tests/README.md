# The board, at the size it is actually taught on

The whiteboard tests drive a desktop-sized window. That is exactly the window in which the
worst phone bug this project has had was invisible: the board looked correct on a laptop while
a teacher on an iPhone had **no Selection tool at all** — it was rendered at x = -23, off the
left edge of the screen — so they could not select, move or resize anything they had drawn.

CLAUDE.md says to design for a cheap Android phone rather than a developer's laptop. These are
that sentence, as tests.

## Running them

Both need a build and Playwright:

```
pnpm.cmd --filter @workspace/sikshya run build
pnpm.cmd --filter @workspace/sikshya run test:phone
pnpm.cmd --filter @workspace/sikshya run test:photo
```

## test:phone — the toolbar fits

Opens the real board at three widths: iPhone 14 Pro (393px), iPhone SE (375px) and a small
Android (360px). At each one it asserts the editor is in its phone layout, that **no tool lands
off screen**, that Selection specifically is reachable, that the toolbar sits inside the screen,
that the page does not scroll sideways, and that a teacher can still draw.

Against the build that shipped before the fix, all three sizes report exactly
`off screen: Selection`.

## test:photo — a phone photo reaches the class

Generates a 12-megapixel photo — the resolution a current iPhone shoots at, filled with noise so
it cannot compress away to nothing — and drops it on the teacher's board the way the editor's
own image tool inserts one. It then asserts that what goes on the wire is within the server's
limits, that the picture travels with its element, and that the student's canvas actually
renders it rather than an empty frame.

The fixture is generated rather than committed: an 8 MB binary in the repository to prove a
size limit is its own kind of silly, and generating it means the fixture is always the size the
test claims. `PHONE_PHOTO=/path/to/photo.jpg` runs it against a real photo instead.

## What these tests do *not* cover

They run in Chromium, not iOS Safari, which cannot be run on a build machine. The measurements
that matter here — layout width, what goes on the wire — are the same in both. Things that are
not the same, and still need a real phone to confirm, are the file picker's behaviour and
Safari's canvas memory limits. Where that mattered, `ISSUES.md` says so rather than claiming
more than was checked.
