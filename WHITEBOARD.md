# The Smart Whiteboard — integration plan

This is the plan for turning the current board into a modern one: shape recognition,
handwriting-to-text, per-object manipulation, and an infinite canvas.

Read the first section if you only read one. It is the part that decides the budget.

---

## The short version

| Requirement | How it gets built | Status |
|---|---|---|
| Smart shape recognition | Custom geometric recogniser, no dependencies | **Built and shipped** |
| Per-object select / drag / rotate / scale | Adopt a drawing engine — do not hand-build | Planned |
| Infinite canvas, 60fps pan and zoom | Same engine | Planned |
| Real-time multilingual handwriting → text | Paid service. There is no free option that does Devanagari well | Planned, needs a budget decision |

Two of the four are "adopt an engine and wire it up". One is already done. One costs money
every month, and I would not pretend otherwise.

---

## 1. What exists today

The board is a custom SVG surface (`components/WhiteboardCanvas.tsx`, ~400 lines) driven by
pointer events, with strokes broadcast over the classroom WebSocket as append-only messages:

```
draw_commit  → one finished stroke
board_clear  → wipe
board_size   → the teacher's coordinate space, so strokes land in the right place elsewhere
board_state  → replay for late joiners
```

It draws well. What it cannot do is treat what has been drawn as *things*. A stroke is a path
string; there is no object to select, no transform to apply, and no canvas beyond the visible
rectangle. That is the gap.

### Already added: shape recognition

`components/smartboard/` is new and working. Draw a rough circle and you get a clean circle;
a lumpy box becomes a rectangle; a sketched triangle becomes a triangle; a dashed-off line
straightens; a line with a barb becomes an arrow. There is a **Smart** toggle (the lightning
bolt) in the toolbar to turn it off.

Three properties worth knowing, because they are what make it safe to leave on:

- **It is geometric, not machine-learned.** No model to download, no weights to ship, under a
  millisecond per stroke, identical results on every device, and it works offline. In a
  low-bandwidth market, anything that needed a server round-trip per stroke would be unusable.
- **It knows when it is unsure.** Below a confidence threshold the original ink is kept
  untouched. Wrongly "correcting" what a teacher drew is much worse than not helping.
- **It never touches handwriting.** Open curved strokes are rejected outright, and closed
  strokes must enclose a plausible fraction of their own bounding box. A line of Devanagari —
  a long horizontal bar with letterforms hanging beneath — starts and ends close enough
  together to look like a closed loop, and an earlier version turned it into a triangle. It
  now stays as writing.

The classifier's core insight is that **enclosed area is the cleanest signal**: a rectangle
fills its bounding box, an ellipse fills π/4 (~0.785) of it, a triangle fills half. That ratio
is a property of the shape, not of how it was drawn. Counting corners was tried first and was
unreliable — the point where a stroke closes lands on a corner about as often as not, so
squares counted three corners and triangles counted two.

Output goes onto the wire in the **existing** message format: recognised circles, rectangles,
lines and arrows use the protocol's own types, and ellipses and triangles are sent as ordinary
freehand paths whose `d` happens to be perfect geometry. So the server needed no change, and a
student on a phone that has not updated still sees the snapped shapes correctly.

---

## 2. Which engine to adopt

Do not hand-build object manipulation and an infinite canvas. Selection handles, rotation
about an arbitrary origin, group transforms, hit-testing, snapping, z-ordering, undo across
all of it, and 60fps at a thousand objects is one to two years of work, and it is work that
several teams have already done and given away.

**Recommendation: Excalidraw** (`@excalidraw/excalidraw`).

| | tldraw | **Excalidraw** | Konva |
|---|---|---|---|
| Object select / rotate / scale / group | Excellent | Good | Build it yourself |
| Infinite canvas, smooth zoom | Excellent | Good | Build it yourself |
| Freehand quality | Excellent | Good | Plain |
| Embedding & programmatic control | Best-in-class API | Good (`excalidrawAPI`) | It is a library, not an editor |
| Licence | Free **with a watermark**; removing it needs a paid business licence | **MIT — free, no watermark** | MIT |
| Right for us | If the licence is affordable | **Yes** | No — it is a canvas library, not an editor |

Excalidraw is the recommendation because it is MIT: no per-seat cost, no watermark, no
renegotiation when the school count grows. For a bootstrapped product selling into Nepal that
matters more than tldraw's (real) polish advantage.

tldraw is the better editor. If there is budget later, it is a worthwhile upgrade, and because
recognition is kept in its own module the swap is contained.

> Verify current licence terms before committing — both projects have changed them before.

---

## 3. The cross-platform problem, and the answer

This is the part that catches people out.

Excalidraw and tldraw are **React DOM** libraries. This app is Expo / React Native. So:

- **On web** (`hometuition.praksh-dhakal.workers.dev`) the app already renders to the DOM via
  react-native-web, so the engine mounts directly. No wrapper needed.
- **On the iOS and Android apps** there is no DOM. The engine has to run inside a WebView.

That sounds like a compromise and mostly is not: it means *one* board implementation, *one*
sync protocol, and identical behaviour everywhere — which is exactly what went wrong before,
when web and native drifted apart.

```
components/
  SmartBoard.web.tsx   → mounts <Excalidraw/> directly
  SmartBoard.tsx       → <WebView/> with the bundled board, bridged over postMessage
  smartboard/          → recognition. Pure, shared, engine-agnostic. Already built.
```

Metro picks `.web.tsx` for web and `.tsx` for native automatically — the same mechanism
`DailyEmbed` already uses, so this is a pattern the codebase follows rather than a new one.

**The one real cost:** WebView performance on cheap Android hardware, which is exactly the
hardware a lot of Nepali teachers will have. Test on a low-end device early, not at the end. If
it disappoints, the fallback is to keep the current native SVG board for phones and use the
full engine on web and tablets — the recognition module works with both.

### Syncing it

The current protocol appends strokes. An object board needs objects to *change* — move, rotate,
delete — so append-only stops being enough.

Use **Yjs** (`yjs` + `y-websocket`). It is a mature CRDT: concurrent edits merge without a
central referee, late joiners sync automatically, and brief disconnections heal on reconnect
instead of losing work. Both engines have established Yjs integrations. Keep the existing
WebSocket hub for presence, chat and session status; add a Yjs document per session for the
board.

Server-side, the board state moves from the in-memory `boards` map in `classroomHub.ts` to a
Yjs document. Persistence is then almost free, which opens up "send students the board after
class" — something teachers ask for constantly.

---

## 4. Handwriting to text: the honest assessment

**Real-time multilingual handwriting recognition, including Devanagari, is a paid capability.
No free JavaScript library does it acceptably.** Anyone who says otherwise is thinking of
printed-text OCR, which is a different problem — Tesseract.js scores near zero on cursive
Devanagari.

The genuine options:

| Option | Devanagari | Real-time | Runs where | Cost |
|---|---|---|---|---|
| **Google ML Kit Digital Ink** | Yes | Yes, on-device | Native apps only | **Free**, works offline |
| **Google Cloud Vision** (`DOCUMENT_TEXT_DETECTION`) | Yes | No — 0.3–1s per call | Anywhere, via our server | Per request |
| **MyScript iink** | Yes | Yes, genuinely incremental | Anywhere | Commercial, per seat |

Recommended approach, in order:

1. **Ship "convert to text" as a deliberate action, not a live effect.** The teacher writes,
   lassos it, taps convert. This is honest about the latency, and it is what teachers actually
   want — live conversion mid-word is distracting when it guesses wrong.
2. **Back it with Cloud Vision through our own server** so the API key is never in the app and
   both web and native work from day one.
3. **Add ML Kit on native later** for free, instant, offline recognition on phones. Same
   interface, so the board does not change.

The interface to build against:

```ts
export interface RecognitionProvider {
  name: string;
  languages: string[];              // ["en", "ne", "hi"]
  recognize(strokes: Point[][], opts: { language: string }): Promise<{
    text: string;
    confidence: number;
  }>;
}
```

Everything above the board talks to that. Swapping Cloud Vision for ML Kit or MyScript is then
one file, and it can be chosen per platform.

**Budget note:** at a few hundred conversions a day Cloud Vision is a small monthly cost. Set a
quota cap on the Google Cloud project on day one — an unbounded key is how a side project
becomes a surprise invoice.

---

## 5. Migration order

Each step ships on its own and leaves the product working. Do not do them all at once.

1. **Recognition module** — done. Works with the current board and will work with the next one.
2. **Toolbar fixes** — done. Undo, redo and clear are pinned outside the scrolling strip
   (they were scrolled off-screen behind a hidden scrollbar, which is why they looked missing).
3. **Mount Excalidraw on web only**, behind a feature flag, sharing the current WebSocket for
   presence. Prove the board on a laptop before touching phones.
4. **Move board state to Yjs.** Web-only still. This is the deep change; do it while only one
   platform is affected.
5. **WebView wrapper for native.** Test on the cheapest Android device you can find.
6. **Handwriting conversion** behind the provider interface. Cloud Vision first.
7. **Retire the old board** once the new one has taught real classes.

Steps 3–5 are the substantial ones. Realistically that is a couple of weeks of focused work,
not an afternoon — and it is worth pacing, because the whiteboard is the product.

---

## 6. What is deliberately not being done

- **No custom rendering engine.** Adopt, do not build.
- **No per-stroke network recognition.** Shape recognition stays local and instant.
- **No live handwriting conversion at first.** Deliberate conversion is better UX and honest
  about the latency.
- **No new wire protocol for shapes right now.** Recognised shapes reuse the existing message
  types, so nothing else had to change to ship them.
