# The Smart Whiteboard — integration plan

This is the plan for turning the current board into a modern one: shape recognition,
per-object manipulation, an infinite canvas, and a class that all sees the same thing.

Read the first section if you only read one. It is the part that decides the budget.

---

## The short version

| Requirement | How it is built | Status |
|---|---|---|
| Smart shape recognition | Custom geometric recogniser, no dependencies | Built, not currently wired up — see section 1 |
| Per-object select / drag / rotate / scale | Excalidraw | **Built** |
| Infinite canvas, 60fps pan and zoom | Excalidraw | **Built** |
| Every student sees what the teacher sees | Element deltas + a broadcast viewport | **Built** |
| Handwriting → text, any language | Needs a purpose-built engine — see section 4 | Not done, needs a budget decision |

The board now runs on Excalidraw. Handwriting recognition is the one thing not built: the
free route was tried, shipped and withdrawn, and section 4 explains why rather than pretending
otherwise.

---

## 1. What the board was, and what changed

The board *was* a custom SVG surface (`components/WhiteboardCanvas.tsx`) driven by pointer
events, with strokes broadcast over the classroom WebSocket as append-only messages:

```
draw_commit  → one finished stroke
board_clear  → wipe
board_size   → the teacher's coordinate space, so strokes land in the right place elsewhere
board_state  → replay for late joiners
```

It drew well. What it could not do was treat what had been drawn as *things*. A stroke was a
path string: nothing to select, no transform to apply, and no canvas beyond the visible
rectangle. That was the gap, and Excalidraw closes it.

The old surface (`WhiteboardCanvas.tsx`) is no longer rendered anywhere. A shared photo is
drawn behind the board and annotated with Excalidraw's own tools, and a shared PDF opens in the
browser's PDF viewer; making the photo a real Excalidraw image element, so it can be moved and
scaled with everything else, is the piece still waiting to move across.

### Shape recognition

`components/recognition/` works: draw a rough circle and you get a clean circle; a lumpy box
becomes a rectangle; a sketched triangle becomes a triangle; a dashed-off line straightens; a
line with a barb becomes an arrow.

**It is not reaching the board at present.** Its only caller was the old SVG surface, and that
stopped being rendered when Excalidraw arrived — the **Smart** toggle lived in a toolbar whose
buttons had all been disconnected, and that toolbar has now been removed. The module is intact
and engine-agnostic, which is what it was built for; wiring it back means catching Excalidraw's
freehand commit and replacing the element with the recognised one, in `SmartBoard.web.tsx`.

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
  SmartBoard.tsx       → <WebView/> pointed at /board, bridged over postMessage
  recognition/         → shape recognition. Pure, shared, engine-agnostic.
```

Metro picks `.web.tsx` for web and `.tsx` for native automatically — the same mechanism
`DailyEmbed` already uses, so this is a pattern the codebase follows rather than a new one.

**The one real cost:** WebView performance on cheap Android hardware, which is exactly the
hardware a lot of Nepali teachers will have. Test on a low-end device early, not at the end. If
it disappoints, the fallback is to keep the current native SVG board for phones and use the
full engine on web and tablets — the recognition module works with both.

### How it syncs

The old protocol only appended strokes. An object board needs objects to *change* — move,
rotate, delete — so append-only stopped being enough.

What is built: **element deltas with version-wins merging.** Excalidraw stamps every element
with a `version` it increments on each edit. The teacher's board broadcasts only elements whose
version has moved since the last send, and both the server and every client apply the same rule
— an element is accepted only if its version is higher than the copy already held.

Two consequences make this worth the small amount of code:

- **Order stops mattering.** A message that arrives late cannot resurrect a deleted shape or
  undo a move, because its version is lower and it is dropped. The server drops stale messages
  rather than forwarding them, so no client can end up holding something the server does not.
- **Messages stay small.** Only what changed goes on the wire, batched over ~120ms. A full
  scene per stroke would be tens of kilobytes a message on a Nepali mobile connection.

The teacher is authoritative and students are read-only, enforced server-side. That matches how
a class runs and removes an entire category of conflict.

**Erasing is an edit, and the diff has to be able to see it.** Excalidraw does not remove a
rubbed-out element; it flags it `isDeleted` and bumps its version — and `getSceneElements()`
hides exactly those. Diffing against that produced no delta at all for a deletion, so students
kept everything the teacher had erased, piled under whatever replaced it: erase a scribble,
draw an arrow, erase that, write a word, and the student saw all three at once. The diff runs
over `getSceneElementsIncludingDeleted()`, which makes a deletion an ordinary version bump.
Tombstones are kept on both sides rather than dropped — they are what lets a late message for
something already erased be recognised as stale — and the server prunes them once a board grows
implausibly large.

**The other half of "the same board" is the same *view*.** An infinite canvas means matching
elements is not enough: a student whose viewport sat somewhere else saw an empty stretch of
board and had to pinch around hunting for the lesson. The teacher publishes the rectangle they
are looking at, in scene coordinates (`board_view`), and each student fits it to their own
screen — fits, not copies, because a phone and a laptop are nothing like the same shape, and
fitting guarantees everything the teacher can see is on screen for the student too. It is
replayed to late joiners for the same reason the elements are. A student who pans or zooms
themselves stops following, so reading a detail is possible, and a **Follow the teacher**
button takes them back.

**If simultaneous editing is ever wanted** — students drawing on the same board — this is the
point to bring in **Yjs** (`yjs` + `y-websocket`). It is a mature CRDT that merges concurrent
edits without a central referee. It is deliberately *not* used now: it would be real complexity
bought for a capability the product does not yet offer.

Board state lives in the in-memory `boards` map in `classroomHub.ts`, so it is lost if the
server restarts mid-class. Persisting it is the obvious next step and would also enable "send
students the board after class", which teachers ask for constantly.

---

## 4. Handwriting to text: the honest assessment

**Real-time multilingual handwriting recognition, including Devanagari, is a paid capability.
No free JavaScript library does it acceptably.** Anyone who says otherwise is thinking of
printed-text OCR, which is a different problem — Tesseract.js scores near zero on cursive
Devanagari.

This was tried anyway, on the theory that English-only OCR on the device was worth having for
free. It was not, and it is now removed. Tesseract reads *printed* text; handwriting is a
different problem even in English, and the failures are not near misses — a deliberately large,
clearly drawn **B** came back as **L**. A button that confidently replaces what a teacher wrote
with a different letter is worse than no button, because the teacher has to notice and undo it
mid-lesson. The `tesseract.js` dependency went with it.

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

1. **Recognition module** — built and self-contained, but not currently called by anything; see
   step 8.
2. **Toolbar** — removed. It drove the replaced engine, so every button in it was dead; the
   board's own controls do the same work and one set of them is the point.
3. **Excalidraw on web** — done. Both classrooms use it; students are read-only.
4. **Element-delta sync** — done, with version-wins merging enforced on the server. Deletions
   and the teacher's viewport are part of it; without either, a student's board drifts out of
   step with the lesson while still looking plausible.
5. **WebView wrapper for native** — done. **Still needs testing on a cheap Android device**,
   which is the one thing here that cannot be verified from a laptop.
6. **Handwriting conversion** — attempted with on-device OCR, and withdrawn: see section 4.
   Do this properly (ML Kit or MyScript) or not at all.
7. **Make shared material a first-class element.** An uploaded image is currently drawn
   *behind* the board and annotated over the top, which works because the canvas background is
   transparent, but the photo cannot be moved or scaled with the rest of the scene, and it is
   not part of what a student's viewport is fitted to. Turning it into an Excalidraw image
   element fixes both.
8. **Re-wire shape recognition** to Excalidraw's freehand commit — see section 1.
9. **Persist board state** so a server restart does not lose a lesson.
10. **Nepali handwriting**, when there is a budget for it.

---

## 6. What is deliberately not being done

- **No custom rendering engine.** Adopt, do not build.
- **No per-stroke network recognition.** Shape recognition stays local and instant.
- **No live handwriting conversion.** Deliberate "select, then convert" is better UX and
  honest about the latency. And no OCR standing in for handwriting recognition at all: a
  confident wrong answer costs a teacher more than a missing feature.
- **No second toolbar around the board.** Excalidraw owns tools, colours, undo, zoom and
  object handling. A row of pens and shapes underneath it drove a drawing engine that had
  already been replaced, so every one of those buttons was dead — and it cost the board a
  56px strip of the screen to say so. What the board genuinely does not have — clearing for
  the whole class, and getting the properties panel out of the way — is added through
  Excalidraw's own extension points, not alongside it.
- **No CRDT yet.** Yjs is the right answer for simultaneous editing and the wrong answer for
  a board with one author.
