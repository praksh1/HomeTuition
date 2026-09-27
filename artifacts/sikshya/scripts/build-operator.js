const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const appRoot = path.resolve(__dirname, "..");
const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, "");
if (!apiUrl || !/^https?:\/\//i.test(apiUrl)) {
  console.error("Set EXPO_PUBLIC_API_URL to the matching Fadko API origin before building the operator desk.");
  process.exit(1);
}
const output = path.join(appRoot, "operator-web-build");
const expoCli = require.resolve("expo/bin/cli");
const result = spawnSync(process.execPath, [expoCli, "export", "-p", "web", "--output-dir", "operator-web-build", "--clear"], {
  cwd: appRoot,
  stdio: "inherit",
  env: { ...process.env, OPERATOR_BUILD: "1", EXPO_PUBLIC_OPERATOR_SITE: "true", EXPO_PUBLIC_API_URL: apiUrl, CI: "1" },
});
if (result.status !== 0) process.exit(result.status || 1);
const html = fs.readFileSync(path.join(output, "index.html"), "utf8");
if (!/<title>Fadko Desk<\/title>/.test(html)) throw new Error("Operator export has the wrong site identity.");
const bundles = path.join(output, "_expo", "static", "js", "web");
if (!fs.readdirSync(bundles).filter(file => file.endsWith(".js"))
  .some(file => fs.readFileSync(path.join(bundles, file), "utf8").includes(apiUrl))) {
  throw new Error("Operator export does not point to the requested API origin.");
}
console.log("Verified separate Fadko Desk export in operator-web-build.");
