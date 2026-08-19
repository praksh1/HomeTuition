const { getDefaultConfig } = require("expo/metro-config");

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

module.exports = config;
