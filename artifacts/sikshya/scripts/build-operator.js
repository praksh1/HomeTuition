const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { assertBundleTargets } = require("./build-targets.cjs");

const appRoot = path.resolve(__dirname, "..");
const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, "");
if (!apiUrl || !/^https?:\/\//i.test(apiUrl)) {
  console.error("Set EXPO_PUBLIC_API_URL to the matching Fadko API origin before building the operator desk.");
  process.exit(1);
}
const output = path.join(appRoot, "operator-web-build");
const requestedWorkers = process.env.EXPO_EXPORT_MAX_WORKERS?.trim();
if (requestedWorkers && !/^[1-9]\d*$/.test(requestedWorkers)) {
  throw new Error("EXPO_EXPORT_MAX_WORKERS must be a positive whole number.");
}
const result = spawnSync(process.execPath, [require.resolve("expo/bin/cli"), "export", "-p", "web", "--output-dir", "operator-web-build", ...(requestedWorkers ? ["--max-workers", requestedWorkers] : []), "--clear"], {
  cwd: appRoot,
  stdio: "inherit",
  env: { ...process.env, EXPO_NO_DOTENV: "1", OPERATOR_BUILD: "1", EXPO_PUBLIC_OPERATOR_SITE: "true", EXPO_PUBLIC_API_URL: apiUrl, CI: "1" },
});
if (result.status !== 0) process.exit(result.status || 1);
const html = fs.readFileSync(path.join(output, "index.html"), "utf8");
if (!/<title>Fadko Desk<\/title>/.test(html)) throw new Error("Operator export has the wrong site identity.");
const bundles = path.join(output, "_expo", "static", "js", "web");
assertBundleTargets(fs.readdirSync(bundles).filter(file => file.endsWith(".js"))
  .map(name => ({ name, source: fs.readFileSync(path.join(bundles, name), "utf8") })), apiUrl);
// Keep this private desk outside browser caches and search results. Cloudflare joins
// overlapping header values, so do not append conflicting public caching rules.
fs.writeFileSync(path.join(output, "_headers"), `/*\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  X-Robots-Tag: noindex, nofollow\n`);
console.log("Verified separate Fadko Desk export in operator-web-build.");
