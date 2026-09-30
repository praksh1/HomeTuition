const assert = require("node:assert/strict");

/** Check every chunk, not merely whether one HTTP module contains the right target. */
function assertBundleTargets(bundles, expected) {
  assert(bundles.length > 0, "Build produced no JavaScript bundles");
  const target = expected.trim().replace(/\/+$/, "");
  const targetHost = new URL(/^https?:\/\//i.test(target) ? target : `https://${target}`).hostname;
  let found = false;
  for (const { name, source } of bundles) {
    // Escaped URL slashes are legal JavaScript too. Inspect hostname text rather than
    // only HTTP literals: wsUrl may convert an HTTP literal to WSS at runtime.
    const text = source.replace(/\\\//g, "/");
    found ||= text.includes(target);
    const railwayHosts = text.match(/\b(?:[a-z\d-]+\.)+up\.railway\.app\b/gi) ?? [];
    for (const host of railwayHosts) {
      assert.equal(
        host.toLowerCase(), targetHost.toLowerCase(),
        `Mixed API targets in ${name}: ${host} is not ${targetHost}. Re-export with a clean Metro cache.`,
      );
    }
  }
  assert(found, `No JavaScript bundle contains the requested API target ${target}`);
}

module.exports = { assertBundleTargets };
