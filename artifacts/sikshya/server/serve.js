/**
 * Standalone production server for the Expo static web export (`expo export -p web`).
 *
 * Serves the single-page app in ./web-build/ over plain HTTP. Any request that isn't
 * a real file on disk falls back to index.html so expo-router's client-side routes
 * (e.g. /(student)/teacher/5) resolve correctly on a hard refresh or direct link.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT = path.resolve(__dirname, "..", "web-build");
const INDEX_PATH = path.join(STATIC_ROOT, "index.html");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  // A module script served as anything but JavaScript is refused by the browser outright.
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
  ".wasm": "application/wasm",
};

function serveFile(filePath, res, status = 200) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  res.writeHead(status, { "content-type": contentType });
  res.end(content);
}

function serveIndexFallback(res) {
  if (!fs.existsSync(INDEX_PATH)) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Build not found. Run the build step first.");
    return;
  }
  serveFile(INDEX_PATH, res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(STATIC_ROOT, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveFile(filePath, res);
    return;
  }

  // No matching static asset — treat as a client-side route and hand back the SPA shell.
  serveIndexFallback(res);
});

const port = parseInt(process.env.PORT || "3000", 10);
server.listen(port, "0.0.0.0", () => {
  console.log(`Serving static web export on port ${port} (base path: ${basePath || "/"})`);
});
