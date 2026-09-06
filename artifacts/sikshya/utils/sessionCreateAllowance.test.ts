import assert from "node:assert/strict";
import test from "node:test";

import { allowancePresentation, limitDetailsFromResponse } from "./sessionCreateAllowance.ts";

test("allowance copy names the real tier, rolling unit, and remaining count", () => {
  const view = allowancePresentation({
    tier: "tier1",
    tierName: "Tier 1",
    limit: 15,
    used: 11,
    remaining: 4,
    price: 2800,
  });

  assert.equal(view.heading, "Tier 1 teaching plan");
  assert.equal(view.usage, "4 of 15 classes remain in your busiest 30-day period.");
  assert.equal(view.billing, "NPR 2,800 per 30 days");
  assert.equal(view.isFullAtBusiestPoint, false);
});

test("a full busiest window does not claim that every possible date is blocked", () => {
  const view = allowancePresentation({
    tier: "base",
    tierName: "Base",
    limit: 10,
    used: 10,
    remaining: 0,
    price: 2000,
  });

  assert.match(view.usage, /A different date may still fit\./);
  assert.equal(view.isFullAtBusiestPoint, true);
});

test("operator-granted access never looks like a purchased plan", () => {
  const view = allowancePresentation({
    tier: "tier4",
    tierName: "Tier 4",
    limit: 30,
    used: 2,
    remaining: 28,
    price: 4700,
    testAccess: { validUntil: "2026-09-30T00:00:00.000Z", reason: "Owner testing" },
  });

  assert.equal(view.heading, "Tier 4 test allowance");
  assert.equal(view.billing, "Temporary test access — no plan payment was processed.");
});

test("a 402 response keeps useful allowance details without trusting malformed fields", () => {
  assert.deepEqual(
    limitDetailsFromResponse("Plan limit reached.", {
      allowance: { freesAt: "2026-10-01T00:00:00.000Z", upgradeTo: "tier2" },
    }),
    {
      message: "Plan limit reached.",
      freesAt: "2026-10-01T00:00:00.000Z",
      upgradeTo: "tier2",
    },
  );

  assert.deepEqual(limitDetailsFromResponse("Plan limit reached.", { allowance: "invalid" }), {
    message: "Plan limit reached.",
    freesAt: null,
    upgradeTo: null,
  });
});
