/**
 * Write `.expo/types/router.d.ts` from the routes that are actually in `app/`.
 *
 * ## Why the typecheck cannot be trusted without this
 *
 * `typedRoutes` is on in `app.json`, so `router.replace("/(teacher)/programs")` is checked against a
 * union of every route in the project. That union lives in `.expo/types/router.d.ts`, which is
 * **gitignored** and written by whichever `expo start` or `expo export` ran last.
 *
 * So `tsc` was answering a different question on every machine:
 *
 * - no file at all → typed routes are inert and every route string passes, however wrong;
 * - a file from before a route was added → that route fails, and the fix looks like deleting the
 *   navigation rather than regenerating a cache;
 * - a file written by a build a moment earlier → passes, which is what happened here and is why a
 *   branch went to review with a typecheck that failed on a clean checkout.
 *
 * Codex found the third case: seven program navigation calls failed on `7da1036` from a fresh
 * checkout, and passed for me, because my own web build had just regenerated the file.
 *
 * ## What this does
 *
 * Regenerates the file before `tsc` runs, from `app/` as it is on disk, using **expo-router's own
 * generator** — the same `getTypedRoutesDeclarationFile` that `@expo/cli` calls from the dev server.
 * Not a reimplementation of the route rules, which would drift from the real ones and be worse than
 * no check at all.
 *
 * It fails loudly rather than quietly skipping. A typecheck that silently stops checking routes is
 * the state this script exists to end, so if an Expo upgrade moves the module, that is a build
 * error with the reason in it and not a green run that proves less than it used to.
 *
 * Run directly:  node scripts/router-types.js
 */
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const routesDir = path.join(appRoot, "app");
const typesDir = path.join(appRoot, ".expo", "types");

if (!fs.existsSync(routesDir)) {
  console.error(`No app directory at ${routesDir}. Run this from artifacts/sikshya.`);
  process.exit(1);
}

// The ponyfill reads this to find the routes; it is what the dev server sets too.
process.env.EXPO_ROUTER_APP_ROOT = routesDir;

let declaration;
try {
  const requireContext = require("expo-router/build/testing-library/require-context-ponyfill").default;
  const { EXPO_ROUTER_CTX_IGNORE } = require("expo-router/_ctx-shared");
  const { getTypedRoutesDeclarationFile } = require("expo-router/build/typed-routes/generate");
  const ctx = requireContext(routesDir, true, EXPO_ROUTER_CTX_IGNORE);
  declaration = getTypedRoutesDeclarationFile(ctx);
} catch (err) {
  console.error(
    "Could not load expo-router's route-type generator. Typed routes would silently stop being\n" +
      "checked, so this is a failure rather than a skip. Has the Expo SDK moved\n" +
      "`expo-router/build/typed-routes/generate`?\n\n" +
      String(err && err.stack ? err.stack : err),
  );
  process.exit(1);
}

if (!declaration) {
  console.error("expo-router produced no route declarations. Is `app/` empty or unreadable?");
  process.exit(1);
}

fs.mkdirSync(typesDir, { recursive: true });
fs.writeFileSync(path.join(typesDir, "router.d.ts"), declaration);

if (process.env.ROUTER_TYPES_QUIET !== "1") {
  console.log("Wrote .expo/types/router.d.ts from the routes in app/.");
}
