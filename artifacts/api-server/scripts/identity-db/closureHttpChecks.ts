import assert from "node:assert/strict";
import express from "express";
import router from "../../src/routes/accountClosure";
import { signToken } from "../../src/lib/auth";
import { pool } from "./database";
export async function runClosureHttpChecks(
  test: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No test listener");
  const call = async (path: string, id: number, body?: unknown) => {
    const token = signToken({
      userId: id,
      email: "synthetic@example.invalid",
      role: id >= 201 && id !== 401 ? "admin" : "student",
    });
    const res = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      cache: res.headers.get("cache-control"),
      body: await res.json(),
    };
  };
  try {
    await test("closure HTTP is disabled by default and requires explicit confirmation", async () => {
      delete process.env.ACCOUNT_CLOSURE_REQUESTS_ENABLED;
      assert.equal((await call("/account-closure", 401)).status, 503);
      process.env.ACCOUNT_CLOSURE_REQUESTS_ENABLED = "true";
      assert.equal((await call("/account-closure", 401, {})).status, 400);
      assert.equal(
        (await call("/account-closure", 402, { confirmed: true })).status,
        403,
      );
    });
    await test("closure HTTP owns requests server-side and rejects stale cancellation", async () => {
      const result = await call("/account-closure", 401, {
        confirmed: true,
        userId: 102,
      });
      assert.equal(result.status, 200);
      const own = await call("/account-closure", 401);
      assert.equal(own.cache, "no-store");
      assert.equal(own.body.request.status, "requested");
      assert.equal((await call("/account-closure", 102)).body.request, null);
      assert.equal(
        (await call("/account-closure/cancel", 401, { version: 99999 })).status,
        409,
      );
      assert.equal(
        (
          await call("/account-closure/cancel", 401, {
            version: own.body.request.version,
          })
        ).status,
        200,
      );
    });
    await test("closure review denies students disabled and password-reset operators", async () => {
      for (const id of [401, 203, 204, 202])
        assert.equal((await call("/account-closure-review", id)).status, 403);
      assert.equal(
        (await call("/account-closure-review?after=oops", 402)).status,
        400,
      );
      assert.equal((await call("/account-closure-review", 402)).status, 200);
      const evidence = await call("/account-closure-review/401", 402);
      assert.equal(evidence.status, 200);
      assert.equal(evidence.body.completionAvailable, false);
      assert.equal(
        JSON.stringify(evidence.body).includes("detailsCiphertext"),
        false,
      );
    });
    await test("closure completion HTTP requires enabled rollout, healthy worker and deliberate operator confirmation", async () => {
      await pool.query(
        "INSERT INTO users(id,role,name) VALUES(405,'student','HTTP closure fixture')",
      );
      const requested = await call("/account-closure", 405, {
        confirmed: true,
      });
      const version = requested.body.request.version;
      assert.equal(
        (await call("/account-closure-review/405/complete", 402, { version }))
          .status,
        400,
      );
      assert.equal(
        (
          await call("/account-closure-review/405/complete", 402, {
            version,
            confirmed: true,
          })
        ).status,
        503,
      );
      Object.assign(process.env, {
        ACCOUNT_CLOSURE_COMPLETION_ENABLED: "true",
        ACCOUNT_CLOSURE_MEDIA_ENABLED: "true",
        VIDEO_PROVIDER: "livekit",
        LIVEKIT_URL: "wss://synthetic.livekit.cloud",
        LIVEKIT_API_KEY: "synthetic-not-real",
        LIVEKIT_API_SECRET: "synthetic-not-real",
      });
      assert.equal(
        (
          await call("/account-closure-review/405/complete", 402, {
            version,
            confirmed: true,
          })
        ).status,
        503,
      );
      await pool.query(
        "INSERT INTO account_closure_worker_health VALUES(1,now())",
      );
      const closed = await call("/account-closure-review/405/complete", 402, {
        version,
        confirmed: true,
      });
      assert.equal(closed.status, 200);
      assert.equal(closed.body.closed, true);
      assert.equal(closed.body.pendingMedia, 0);
      assert.equal((await call("/account-closure", 405)).status, 403);
      assert.equal(
        (
          await call("/account-closure-review/405/complete", 402, {
            version,
            confirmed: true,
          })
        ).body.closed,
        true,
      );
    });
  } finally {
    for (const key of [
      "ACCOUNT_CLOSURE_REQUESTS_ENABLED",
      "ACCOUNT_CLOSURE_COMPLETION_ENABLED",
      "ACCOUNT_CLOSURE_MEDIA_ENABLED",
      "VIDEO_PROVIDER",
      "LIVEKIT_URL",
      "LIVEKIT_API_KEY",
      "LIVEKIT_API_SECRET",
    ])
      delete process.env[key];
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
