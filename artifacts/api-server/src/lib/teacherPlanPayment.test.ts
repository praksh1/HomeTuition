import assert from "node:assert/strict";
import test from "node:test";

import { chargeForMonthly } from "./payments.ts";

const gatewayKeys = ["PAYMENT_WEBHOOK_SECRET", "ESEWA_MERCHANT_ID", "KHALTI_SECRET_KEY"] as const;

async function withoutGateway(nodeEnv: string, run: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>([["NODE_ENV", process.env.NODE_ENV]]);
  for (const key of gatewayKeys) previous.set(key, process.env[key]);
  process.env.NODE_ENV = nodeEnv;
  for (const key of gatewayKeys) delete process.env[key];
  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("a running app cannot turn a simulated teacher plan into paid access", async () => {
  await withoutGateway("production", async () => {
    const result = await chargeForMonthly({
      purpose: "teacher-plan",
      referenceId: 11,
      userId: 22,
      amount: 500,
      method: "test",
    });
    assert.equal(result.ok, false);
    assert.match(result.message ?? "", /No plan was activated/);
  });
});

test("the isolated test environment can still exercise the paid-plan success path", async () => {
  await withoutGateway("test", async () => {
    const result = await chargeForMonthly({
      purpose: "teacher-plan",
      referenceId: 11,
      userId: 22,
      amount: 500,
      method: "test",
    });
    assert.equal(result.ok, true);
    assert.match(result.reference ?? "", /^SIM-M-/);
  });
});
