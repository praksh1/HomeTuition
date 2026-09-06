import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bundles a component for a browser test, on whatever machine is running it.
 *
 * ## Why this exists rather than spawning esbuild
 *
 * Three suites need the same thing — take one of the app's `.tsx` components, swap the provider
 * SDK underneath it for a fake, and produce one file a headless browser can load. Each of them
 * grew its own way of starting esbuild, and each way was broken on somebody's machine:
 *
 * - `node_modules/.bin/esbuild` is an extensionless shim. **Windows cannot execute it**, so the
 *   suites would not start on the owner's machine at `C:\Projects\Paathshala\Paathshala`.
 * - `node <path>/esbuild/bin/esbuild` fixes Windows, where that file is a JavaScript launcher —
 *   and **breaks Linux**, where the same path is the native binary itself and Node reads `ELF`
 *   as a syntax error. That is CI, and this container.
 *
 * There is no CLI path that is correct on both, because the package deliberately puts different
 * things there per platform. The JavaScript API has no such problem: it is the same module
 * everywhere and it finds its own binary. So the answer is to stop spawning anything.
 *
 * ## Resolving esbuild
 *
 * It is a dependency of `api-server`, not of this app — these suites are the only thing here
 * that bundles. Resolved through `createRequire` from that package rather than by walking
 * `../../..` into `node_modules`, because pnpm's layout is not a path you can guess and the
 * guess is what broke first.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const apiServerPackage = path.resolve(here, "..", "..", "api-server", "package.json");

/**
 * @param {object} options
 * @param {string} options.entry      the entry file to bundle
 * @param {string} options.outfile    where to write the bundle
 * @param {Record<string,string>} [options.alias]  module id → absolute path of its stand-in
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function bundleForBrowser({ entry, outfile, alias = {} }) {
  let esbuild;
  try {
    const require = createRequire(apiServerPackage);
    esbuild = await import(require.resolve("esbuild"));
  } catch (err) {
    return {
      ok: false,
      error: `Could not load esbuild from ${apiServerPackage}: ${err.message}. Has \`pnpm install\` been run?`,
    };
  }

  try {
    await (esbuild.build ?? esbuild.default.build)({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "iife",
      jsx: "automatic",
      loader: { ".tsx": "tsx", ".ts": "ts" },
      define: { "process.env.NODE_ENV": '"production"' },
      alias: {
        // These components are React Native files being run in a browser; every suite needs it.
        "react-native": "react-native-web",
        ...alias,
      },
      logLevel: "error",
      absWorkingDir: appRoot,
      /*
        Where `react` and friends are found.

        The entry file each suite writes lives in a temporary directory, and esbuild resolves a
        bare import by walking up from the importing file — which from `/tmp` reaches nothing.
        `nodePaths` is the escape hatch: it names the app's own `node_modules` explicitly, so a
        harness can keep its scratch files out of the repository and still resolve React.
      */
      nodePaths: [path.join(appRoot, "node_modules")],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
