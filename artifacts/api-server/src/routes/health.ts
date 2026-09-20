import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Deployment readiness is stronger than process liveness.
 *
 * `/healthz` deliberately remains the cheap answer used by local test harnesses. Railway uses
 * this route before moving traffic: a server that can listen but cannot reach Postgres cannot
 * sign anybody in and is not ready to replace the previous deployment.
 */
router.get("/readyz", async (req, res): Promise<void> => {
  try {
    await pool.query("select 1 as ready");
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch (error) {
    req.log?.warn({ error }, "readiness check could not reach the database");
    res.status(503).json({ status: "unavailable" });
  }
});

export default router;
