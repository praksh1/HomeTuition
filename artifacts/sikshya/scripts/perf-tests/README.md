# The whiteboard on a slow phone

CLAUDE.md says to design for a cheap Android on a poor connection rather than a developer's
laptop. Every other board test runs at full speed on a fast machine, which measures the one
device nobody in this market owns. This one throttles the processor and uses a phone-sized
screen.

## Running it

```
pnpm.cmd --filter @workspace/sikshya run build
pnpm.cmd --filter @workspace/sikshya run test:perf
```

`CPU_SLOWDOWN` sets how much slower to make the processor; the default is 6, which is roughly
a budget Android against a development machine on single-threaded work — and canvas rendering
is single-threaded work.

## What it found

Measured at 6× slowdown, 393×852, a lesson's worth of real elements (freehand strokes,
shapes, text):

| Board contents | Time until a joining student sees it | One new stroke arriving | Memory |
|---|---|---|---|
| 50 things | ~1.2 s | 109 ms median, 179 ms worst | 30 MB |
| 200 things | ~1.1 s | 118 ms median, 229 ms worst | 43 MB |
| 500 things | ~1.6 s | 139 ms median, 290 ms worst | 38 MB |

Pushed further by hand, off the committed path: 1000 elements at 6× paints in 2.5 s, 2000 in
4.4 s. **The board still paints within 10 seconds at 25× slowdown**, which is slower than any
phone likely to be in use.

So the answer to "will the whiteboard cope on a cheap Android" is: on this evidence, yes, with
room to spare.

## Two honest limits on that answer

**This is a simulated processor, not a phone.** Chromium's CPU throttling slows the main
thread; it does not reproduce a weak GPU, memory pressure, thermal throttling, or a phone that
is also running four other apps. It is a good proxy for whether the code is doing something
foolish, and no substitute for holding the device.

**The measurement interfered with itself, and nearly produced a false finding.** Polling for
"has it painted yet" by screenshotting every 500 ms made 12× look like it never painted at all,
and the first draft of this file was going to report a cliff between 6× and 12×. There is no
cliff. Sampling infrequently, from outside the page, showed the board painting fine all the way
to 25×. If you extend these tests, keep the measurement off the thread being measured.

## What the committed suite actually enforces

Most numbers are reported rather than asserted, because "is 300 ms too slow" is a judgement.
Two things fail the run: a board that never becomes visible at all, and a single incoming
stroke taking longer than three seconds — past that the board would visibly stall mid-lesson,
which is not slowness but breakage.
