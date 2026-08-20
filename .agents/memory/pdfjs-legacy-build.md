---
name: Use pdf.js's legacy build, and serve its worker as .js
description: The modern pdfjs-dist bundle needs JavaScript features old Android browsers lack and dies with "getOrInsertComputed is not a function"; and a worker served as .mjs is refused for its MIME type.
---

Sharing a PDF to the whiteboard rasterises its pages with `pdfjs-dist`. Two things about that
are not obvious and both cost an afternoon.

**Import the legacy build, not the default one.**

```ts
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
```

The modern bundle uses very recent JavaScript — `Map.prototype.getOrInsertComputed` among
others — and throws `this[#Ar].getOrInsertComputed is not a function` on any engine without it.
That is not an edge case here: the market is cheap Android phones whose Chrome and WebView run
years behind, and the board itself runs inside that WebView on the phone apps. The legacy build
is transpiled for exactly those browsers. The main thread and the worker must come from the
*same* build — pdf.js rejects a version mismatch.

**Serve the worker with a JavaScript MIME type.**

pdf.js loads its worker by URL, and Metro cannot produce a URL for a file inside node_modules.
It is copied into `public/` at build time by `artifacts/sikshya/scripts/copy-pdf-worker.js` —
Expo copies that directory verbatim into the export — and served from our own origin rather
than a CDN, so sharing a PDF never depends on a third party being reachable from Kathmandu.

It is copied as **`pdf.worker.min.js`, not `.mjs`**. The file is an ES module either way; what
matters is the Content-Type. A module script served as `application/octet-stream` is refused
outright — *"Strict MIME type checking is enforced for module scripts"* — and plenty of static
servers, including this project's own `server/serve.js`, did not recognise `.mjs`. Naming it
`.js` removes the question everywhere.

**How to apply:**
- Rendering happens on the sharer's device only. Students receive ordinary pictures and never
  run a PDF engine, which is the whole point on low-end hardware.
- The engine is behind a dynamic `import()`, so a teacher who never shares a PDF never
  downloads it. Keep it that way; it is over a megabyte.
- If pages ever stop appearing, check the browser console for a MIME complaint or a missing
  method before suspecting the PDF itself. Both failures are silent from the app's side —
  the render simply never produces pages.
