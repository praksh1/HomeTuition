const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

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

  // An explicit API URL wins; only fall back to the single-origin model if it is absent.
  const apiUrl = getApiUrl();
  const domain = apiUrl ? null : getDeploymentDomain();
  console.log(apiUrl ? `API at ${apiUrl}` : `Setting EXPO_PUBLIC_DOMAIN=${domain}`);

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

  const result = spawnSync(
    process.execPath,
    [expoCli, "export", "-p", "web", "--output-dir", "web-build"],
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
    exitWithError("expo export failed");
  }

  if (!fs.existsSync(path.join(outputDir, "index.html"))) {
    exitWithError("Build did not produce web-build/index.html");
  }

  console.log(`Build complete! Static web app ready in web-build/ (base path: ${basePath || "/"})`);
}

main();
