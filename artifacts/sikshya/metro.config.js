const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

/**
 * Teach Metro the export conditions Excalidraw publishes under.
 *
 * Its package exports map offers `./index.css` only under the `development` and `production`
 * conditions, with no `default` fallback. Metro does not ask for either by name, so the
 * stylesheet simply fails to resolve and the whiteboard renders unstyled — which, for a canvas
 * editor whose toolbar is positioned entirely in CSS, means an unusable board rather than an
 * ugly one.
 *
 * Adding the conditions is preferable to importing `dist/prod/index.css` directly: the deep
 * path is not part of the package's public surface and would break on upgrade, whereas the
 * condition names are exactly what the package expects a bundler to supply.
 */
config.resolver.unstable_conditionNames = [
  ...(config.resolver.unstable_conditionNames ?? ["require", "import"]),
  "production",
  "default",
];

if (process.platform === "win32") {
  // This pnpm package is a OneDrive reparse directory in the Windows checkout.
  // The broader node_modules root can miss it during Metro's file-map crawl,
  // so also scan the exact lockfile-pinned dependency as a root for SHA-1.
  const objectAssignDirectory = path.resolve(__dirname, "../../node_modules/.pnpm/object.assign@4.1.7/node_modules/object.assign");
  const atomsEntry = require.resolve("es-object-atoms", { paths: [objectAssignDirectory] });
  config.watchFolders = [...new Set([...(config.watchFolders ?? []), path.dirname(atomsEntry)])];
}

// On Windows with pnpm junctions, Metro's file map can miss this one transitive
// package even though its locked files and junction are present. Keep Metro's
// normal result first; only recover this exact import from object.assign.
const previousResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolveNormally = previousResolveRequest ?? context.resolveRequest;
  try {
    return resolveNormally(context, moduleName, platform);
  } catch (error) {
    const fromObjectAssign = path.basename(path.dirname(context.originModulePath)) === "object.assign" &&
      path.basename(context.originModulePath) === "implementation.js";
    if (process.platform !== "win32" || platform !== "web" || moduleName !== "es-object-atoms" ||
      !fromObjectAssign || error?.constructor?.name !== "FailedToResolveNameError") {
      throw error;
    }
    return {
      type: "sourceFile",
      filePath: require.resolve(moduleName, { paths: [path.dirname(context.originModulePath)] }),
    };
  }
};

module.exports = config;
