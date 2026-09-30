const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { assertBundleTargets: checkBundleTargets } = require("./build-targets.cjs");

const projectRoot = path.resolve(__dirname, "..");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

/**
 * Reads the API address back out of the files that were just produced.
 *
 * A clean export prevents the known cache cause; this checks every emitted chunk. A
 * wrong API address in a bundle is invisible — the build passes, the site loads, and only
 * logins fail — so it is worth failing loudly here instead.
 */
function assertBundleTargets(expected) {
  const jsDir = path.join(projectRoot, "web-build", "_expo", "static", "js", "web");
  let files = [];
  try {
    files = fs.readdirSync(jsDir).filter((f) => f.endsWith(".js"));
  } catch {
    exitWithError(`Build produced no JavaScript to check in ${jsDir}`);
  }
  try {
    checkBundleTargets(files.map((name) => ({
      name,
      source: fs.readFileSync(path.join(jsDir, name), "utf8"),
    })), expected);
  } catch (error) {
    exitWithError(error.message);
  }
  console.log(`Verified all ${files.length} JavaScript chunks: API target ${expected}, no mixed Railway targets.`);
}

/**
 * What the app calls itself, read from the one file that decides it.
 *
 * Kept as a lookup rather than a hardcoded "Fadko" so that this check keeps working through
 * the next rename instead of quietly becoming a check that the app is still called Fadko.
 */
function readIdentity() {
  const expo = JSON.parse(fs.readFileSync(path.join(projectRoot, "app.json"), "utf8")).expo;
  return {
    name: (expo.web && expo.web.name) || expo.name,
    slug: expo.slug,
    scheme: expo.scheme,
  };
}

/**
 * Reads the app's name back out of the files that were just produced.
 *
 * The title is the first thing a student sees — it is the browser tab, and it is the label
 * under the icon when the site is added to an Android home screen. It shipped as "Guru", the
 * name the project was generated under, long after every screen in the app said Fadko.
 *
 * A clean export prevents the stale-cache cause; this also verifies the actual output.
 */
function assertBuildIdentity(identity) {
  const html = fs.readFileSync(path.join(projectRoot, "web-build", "index.html"), "utf8");
  const title = /<title>([^<]*)<\/title>/.exec(html);
  if (!title) {
    exitWithError("Build produced no <title> in web-build/index.html");
  }
  if (title[1].trim() !== identity.name) {
    exitWithError(
      `The built app calls itself "${title[1].trim()}", but app.json says "${identity.name}".\n` +
        "This usually means the bundler served a cached copy of the old name. Delete\n" +
        "node_modules/.cache and try again, or run the export with --clear.",
    );
  }
  console.log(`Verified: the built app calls itself ${identity.name}`);
}

function exitWithError(message) {
  console.error(message);
  process.exit(1);
}

function stripProtocol(domain) {
  let urlString = domain.trim();
  if (!/^https?:\/\//i.test(urlString)) {
    urlString = `https://${urlString}`;
  }
  return new URL(urlString).host;
}

/**
 * Where the built app should look for the API.
 *
 * EXPO_PUBLIC_API_URL is the one to use when the API and the web app live on different
 * hosts — an API on Railway and the site on Cloudflare Pages, for instance. The older
 * EXPO_PUBLIC_DOMAIN assumes both are served from a single origin, which was true on
 * Replit and is not true of most real deployments.
 */
function getApiUrl() {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (!explicit) return null;
  const url = explicit.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) {
    exitWithError(`EXPO_PUBLIC_API_URL must include the scheme, e.g. https://api.example.com (got "${url}")`);
  }
  if (url.startsWith("http://") && process.env.NODE_ENV === "production") {
    console.warn(
      `WARNING: EXPO_PUBLIC_API_URL is plain http (${url}). Browsers block camera and microphone
` +
      "         on non-HTTPS origins, so video calls will not work for anyone using the site.",
    );
  }
  return url;
}

function getDeploymentDomain() {
  if (process.env.REPLIT_INTERNAL_APP_DOMAIN) {
    return stripProtocol(process.env.REPLIT_INTERNAL_APP_DOMAIN);
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return stripProtocol(process.env.REPLIT_DEV_DOMAIN);
  }
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return stripProtocol(process.env.EXPO_PUBLIC_DOMAIN);
  }
  exitWithError(
    "ERROR: No deployment domain found. Set REPLIT_INTERNAL_APP_DOMAIN, REPLIT_DEV_DOMAIN, or EXPO_PUBLIC_DOMAIN",
  );
}

function main() {
  console.log("Building static web export (browser-testable, no Expo Go needed)...");

  // The whiteboard rasterises shared PDFs in the browser, and pdf.js loads its worker by URL.
  // Copied into public/ so it ships with the site instead of being fetched from a CDN.
  require("./copy-pdf-worker.js");

  // An explicit API URL wins; only fall back to the single-origin model if it is absent.
  const apiUrl = getApiUrl();
  const domain = apiUrl ? null : getDeploymentDomain();
  console.log(apiUrl ? `API at ${apiUrl}` : `Setting EXPO_PUBLIC_DOMAIN=${domain}`);

  const identity = readIdentity();
  // A checkout-local stamp cannot guarantee every shared Metro transform has this target.
  // Sep 30 verification caught correct staging HTTP beside cached Production wsUrl output.
  // Static/release exports always clear; development builds keep their normal fast cache.
  console.log("Clearing Metro for a clean, target-specific static export.");

  const outputDir = path.join(projectRoot, "web-build");
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }

  // `expo export -p web` produces a fully static single-page app (index.html + hashed
  // JS/CSS/asset bundles) — no Metro dev server or Expo Go manifest needed at runtime,
  // so it can be served by a plain static file server and works in any browser.
  // Run Expo's CLI directly with this Node binary rather than going through the package
  // manager. `spawnSync("pnpm", ...)` cannot launch pnpm on Windows (it is pnpm.cmd), and the
  // export silently never ran — the build failed with nothing but "expo export failed". This
  // sidesteps package-manager and platform differences altogether.
  const expoCli = require.resolve("expo/bin/cli");
  const requestedWorkers = process.env.EXPO_EXPORT_MAX_WORKERS?.trim();
  if (requestedWorkers && !/^[1-9]\d*$/.test(requestedWorkers)) {
    exitWithError(
      `EXPO_EXPORT_MAX_WORKERS must be a positive whole number (got "${requestedWorkers}")`,
    );
  }

  const exportArgs = [
    expoCli,
    "export",
    "-p",
    "web",
    "--output-dir",
    "web-build",
    ...(requestedWorkers ? ["--max-workers", requestedWorkers] : []),
    "--clear",
  ];
  if (requestedWorkers) {
    console.log(`Limiting Metro to ${requestedWorkers} worker(s) for this export.`);
  }

  const result = spawnSync(
    process.execPath,
    exportArgs,
    {
      cwd: projectRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        ...(apiUrl ? { EXPO_PUBLIC_API_URL: apiUrl } : { EXPO_PUBLIC_DOMAIN: domain }),
        CI: "1",
      },
    },
  );

  if (result.status !== 0) {
    const cause = result.signal
      ? ` after receiving ${result.signal}`
      : ` with status ${result.status}`;
    exitWithError(`expo export failed${cause}`);
  }

  if (!fs.existsSync(path.join(outputDir, "index.html"))) {
    exitWithError("Build did not produce web-build/index.html");
  }

  assertBundleTargets(apiUrl ?? domain);
  assertBuildIdentity(identity);

  console.log(`Build complete! Static web app ready in web-build/ (base path: ${basePath || "/"})`);
}

main();
