import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";
import {
  ensureAccountClosureSchema,
  requestAccountClosure,
  cancelAccountClosure,
  completeAccountClosure,
} from "../lib/accountClosureStore";
import { closureMediaReady } from "../lib/accountClosureMedia";
import { readAccountClosureCommitments } from "../lib/accountClosureCommitments";
import { closureBlockers } from "../lib/accountClosurePolicy";

const router: IRouter = Router();
const unavailable = (res: Response) =>
  res
    .status(503)
    .json({
      error:
        "Could not confirm the request status. Reload before trying again, or contact Support.",
    });
async function enabled(_req: Request, res: Response, next: NextFunction) {
  res.set("Cache-Control", "no-store");
  if (process.env.ACCOUNT_CLOSURE_REQUESTS_ENABLED !== "true") {
    res
      .status(503)
      .json({ error: "Please contact Support to request account closure." });
    return;
  }
  try {
    await ensureAccountClosureSchema();
    next();
  } catch {
    unavailable(res);
  }
}
function member(req: Request, res: Response, next: NextFunction) {
  if (!["teacher", "student"].includes(req.user!.role)) {
    res
      .status(403)
      .json({ error: "This account cannot request closure here." });
    return;
  }
  next();
}
async function operator(req: Request, res: Response, next: NextFunction) {
  try {
    const access =
      await db.execute(sql`SELECT 1 FROM operator_accounts WHERE user_id=${req.user!.userId}
      AND disabled_at IS NULL AND must_change_password=false`);
    if (!access.rows.length) {
      res
        .status(403)
        .json({ error: "An active Support operator account is required." });
      return;
    }
    next();
  } catch {
    unavailable(res);
  }
}
router.get(
  "/account-closure",
  requireAuth,
  enabled,
  member,
  async (req, res) => {
    try {
      const rows = await db.execute(
        sql`SELECT status,version,requested_at AS "requestedAt" FROM account_closure_requests WHERE user_id=${req.user!.userId}`,
      );
      res.json({ request: rows.rows[0] ?? null });
    } catch {
      unavailable(res);
    }
  },
);
router.post(
  "/account-closure",
  requireAuth,
  enabled,
  member,
  async (req, res) => {
    if (req.body?.confirmed !== true) {
      res
        .status(400)
        .json({
          error: "Confirm that you want Support to review account closure.",
        });
      return;
    }
    try {
      res.json({ request: await requestAccountClosure(req.user!.userId) });
    } catch {
      unavailable(res);
    }
  },
);
router.post(
  "/account-closure/cancel",
  requireAuth,
  enabled,
  member,
  async (req, res) => {
    const version = req.body?.version;
    if (!Number.isSafeInteger(version) || version < 0) {
      res
        .status(400)
        .json({ error: "Reload your closure request before cancelling." });
      return;
    }
    try {
      if (!(await cancelAccountClosure(req.user!.userId, version))) {
        res
          .status(409)
          .json({
            error:
              "This request has changed. Reload to see its current status.",
          });
        return;
      }
      res.json({ cancelled: true });
    } catch {
      unavailable(res);
    }
  },
);
router.get(
  "/account-closure-review",
  requireAuth,
  requireAdmin,
  enabled,
  operator,
  async (req, res) => {
    const after = req.query.after === undefined ? 0 : Number(req.query.after);
    if (!Number.isSafeInteger(after) || after < 0) {
      res.status(400).json({ error: "Invalid page cursor." });
      return;
    }
    try {
      const rows =
        await db.execute(sql`SELECT r.user_id AS "userId",r.version,r.requested_at AS "requestedAt",u.name,u.role
      FROM account_closure_requests r JOIN users u ON u.id=r.user_id
      WHERE (r.status='requested' OR (r.status='closed' AND EXISTS(SELECT 1 FROM account_closure_media_jobs j
        WHERE j.user_id=r.user_id AND j.status<>'completed'))) AND r.user_id>${after} ORDER BY r.user_id LIMIT 26`);
      const items = rows.rows.slice(0, 25);
      res.json({
        items,
        nextCursor: rows.rows.length > 25 ? items.at(-1)?.userId : null,
      });
    } catch {
      unavailable(res);
    }
  },
);
router.get(
  "/account-closure-review/:id",
  requireAuth,
  requireAdmin,
  enabled,
  operator,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid account." });
      return;
    }
    try {
      const rows =
        await db.execute(sql`SELECT user_id AS "userId",status,version,requested_at AS "requestedAt"
      FROM account_closure_requests WHERE user_id=${id}`);
      if (!rows.rows.length) {
        res.status(404).json({ error: "Closure request not found." });
        return;
      }
      const commitments = await readAccountClosureCommitments(db, id);
      const media = await db.execute(
        sql`SELECT count(*)::int AS pending FROM account_closure_media_jobs WHERE user_id=${id} AND status<>'completed'`,
      );
      res.json({
        request: rows.rows[0],
        commitments,
        blockers: closureBlockers(commitments),
        pendingMedia: media.rows[0]?.pending ?? 0,
        completionAvailable:
          process.env.ACCOUNT_CLOSURE_COMPLETION_ENABLED === "true" &&
          (await closureMediaReady()),
      });
    } catch {
      unavailable(res);
    }
  },
);
router.post(
  "/account-closure-review/:id/complete",
  requireAuth,
  requireAdmin,
  enabled,
  operator,
  async (req, res) => {
    const userId = Number(req.params.id),
      version = req.body?.version;
    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      !Number.isSafeInteger(version) ||
      version < 0 ||
      req.body?.confirmed !== true
    ) {
      res
        .status(400)
        .json({ error: "Reload the request and explicitly confirm closure." });
      return;
    }
    if (
      process.env.ACCOUNT_CLOSURE_COMPLETION_ENABLED !== "true" ||
      !(await closureMediaReady())
    ) {
      res
        .status(503)
        .json({
          error:
            "Safe closure is not available. No new closure was attempted. Reload to check the current account status.",
        });
      return;
    }
    try {
      const result = await completeAccountClosure({
        userId,
        version,
        operatorId: req.user!.userId,
        confirmed: true,
      });
      if (!result.closed) {
        res
          .status(409)
          .json({
            error:
              "The account cannot close yet. Reload and resolve the outstanding items.",
            blockers: result.blockers,
          });
        return;
      }
      const media = await db.execute(
        sql`SELECT count(*)::int AS pending FROM account_closure_media_jobs WHERE user_id=${userId} AND status<>'completed'`,
      );
      res.json({
        closed: true,
        closedAt: result.closedAt,
        pendingMedia: media.rows[0]?.pending ?? 0,
      });
    } catch {
      unavailable(res);
    }
  },
);
export default router;
