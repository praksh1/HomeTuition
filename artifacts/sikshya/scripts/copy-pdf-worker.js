/**
 * Puts pdf.js's worker where the browser can fetch it.
 *
 * Turning a shared PDF into pages on the whiteboard means rasterising it, and pdf.js does that
 * in a web worker it loads by URL. Metro has no way to hand us a URL for a file inside
 * node_modules, and pointing at a CDN is not an option for a product whose users are on poor
 * connections in Nepal — it would make sharing a PDF depend on a third party being reachable.
 *
 * Expo copies everything in `public/` verbatim into the export, so the worker is copied there
 * at build time and served from our own origin. Copied rather than committed so it can never
 * drift from the installed version of pdfjs-dist, and gitignored for the same reason.
 */
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
/**
 * Deliberately `.js`, not `.mjs`.
 *
 * The file is an ES module either way — what matters to the browser is the Content-Type it is
 * served with, and a module script served as `application/octet-stream` is refused outright
 * ("Strict MIME type checking is enforced for module scripts"). Plenty of static servers,
 * including this project's own, do not recognise `.mjs`. Naming it `.js` removes the question.
 */
const destination = path.join(projectRoot, "public", "pdf.worker.min.js");

function main() {
  let source;
  try {
    // Legacy build, matching the engine the app imports — see utils/pdfToImages.web.ts. A
    // modern worker paired with a legacy main thread is a version mismatch pdf.js rejects.
    source = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs", { paths: [projectRoot] });
  } catch {
    console.error(
      "Could not find pdfjs-dist's worker. Run `pnpm install` first — without it, sharing a\n" +
        "PDF on the whiteboard will fail at runtime with nothing in the build to explain why.",
    );
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  const kb = Math.round(fs.statSync(destination).size / 1024);
  console.log(`PDF worker copied into public/pdf.worker.min.js (${kb} kB)`);
}

main();
