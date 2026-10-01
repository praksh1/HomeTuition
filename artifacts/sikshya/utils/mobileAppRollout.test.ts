import assert from "node:assert/strict";
import test from "node:test";
import { MOBILE_APP_ROLLOUT, mobileAppExperience, type MobileAppRollout } from "./mobileAppRollout.ts";

const phone = { platform: "web", phoneBrowser: true, surface: "participant" } as const;
const ready: MobileAppRollout = { requireAppOnPhones: true, iosPublishedAndClassroomVerified: true, androidPublishedAndClassroomVerified: true,
  appStoreUrl: "https://apps.apple.com/np/app/fadko/id123456789", playStoreUrl: "https://play.google.com/store/apps/details?id=com.fadko.app" };

test("today's release cannot block any phone browser or invent a store destination", () => {
  assert.equal(MOBILE_APP_ROLLOUT.requireAppOnPhones, false);
  assert.equal(MOBILE_APP_ROLLOUT.appStoreUrl, null);
  assert.equal(MOBILE_APP_ROLLOUT.playStoreUrl, null);
  assert.equal(mobileAppExperience(phone), "browser");
});

test("both native classroom releases and both official store URLs are required", () => {
  assert.equal(mobileAppExperience(phone, ready), "require_app");
  for (const key of ["requireAppOnPhones", "iosPublishedAndClassroomVerified", "androidPublishedAndClassroomVerified"] as const) {
    assert.equal(mobileAppExperience(phone, { ...ready, [key]: false }), "browser");
  }
  for (const value of [null, "", "http://apps.apple.com/np/app/fadko/id123", "https://apps.apple.com.example.com/id123", "https://apps.apple.com/app/fadko", "https://name:password@apps.apple.com/app/id123"]) {
    assert.equal(mobileAppExperience(phone, { ...ready, appStoreUrl: value }), "browser");
  }
  for (const value of [null, "https://example.com/store/apps/details?id=fadko", "https://play.google.com/store/apps/details", "https://play.google.com/"]) {
    assert.equal(mobileAppExperience(phone, { ...ready, playStoreUrl: value }), "browser");
  }
});

test("desktop, native apps, support and payment/verification callbacks remain available", () => {
  assert.equal(mobileAppExperience({ ...phone, phoneBrowser: false }, ready), "browser");
  assert.equal(mobileAppExperience({ ...phone, platform: "ios" }, ready), "native");
  assert.equal(mobileAppExperience({ ...phone, platform: "android" }, ready), "native");
  for (const surface of ["public", "support", "verification", "payment_callback", "operator"] as const) {
    assert.equal(mobileAppExperience({ ...phone, surface }, ready), "browser");
  }
});
