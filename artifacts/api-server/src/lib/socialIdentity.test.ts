import assert from "node:assert/strict";
import test from "node:test";

import { socialProviderConfiguration } from "./socialIdentity.ts";

const NAMES = [
  "GOOGLE_CLIENT_IDS",
  "GOOGLE_WEB_CLIENT_ID",
  "GOOGLE_IOS_CLIENT_ID",
  "GOOGLE_ANDROID_CLIENT_ID",
  "FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
  "APPLE_CLIENT_IDS",
] as const;

function withProviderEnvironment(values: Partial<Record<(typeof NAMES)[number], string>>, run: () => void) {
  const previous = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
  for (const name of NAMES) delete process.env[name];
  Object.assign(process.env, values);
  try {
    run();
  } finally {
    for (const name of NAMES) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("social controls stay absent until their providers are fully configured", () => {
  withProviderEnvironment({ FACEBOOK_APP_SECRET: "server-only-secret" }, () => {
    const config = socialProviderConfiguration();
    assert.equal(config.google.enabled, false);
    assert.equal(config.facebook.enabled, false);
    assert.equal(config.apple.enabled, false);
  });
});

test("provider configuration returns public identifiers but never the Facebook secret", () => {
  withProviderEnvironment({
    GOOGLE_ANDROID_CLIENT_ID: "android-public-id",
    FACEBOOK_APP_ID: "facebook-public-id",
    FACEBOOK_APP_SECRET: "server-only-secret",
    APPLE_CLIENT_IDS: "com.sikshya.app",
  }, () => {
    const config = socialProviderConfiguration();
    assert.equal(config.google.enabled, true);
    assert.equal(config.google.androidClientId, "android-public-id");
    assert.equal(config.facebook.enabled, true);
    assert.equal(config.facebook.appId, "facebook-public-id");
    assert.equal(config.apple.enabled, true);
    assert.equal(JSON.stringify(config).includes("server-only-secret"), false);
  });
});
