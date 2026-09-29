import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";
import { operatorByUserId } from "../lib/operatorStore";
import { ownerAllowed, validateSettings } from "../lib/costHealth/policy";
import {
  costDashboard,
  refreshCosts,
  sendCostTestEmail,
} from "../lib/costHealth/service";
import { saveCostSettings } from "../lib/costHealth/store";
import { recordActivity } from "../lib/activityLog";

const router = Router();
async function isOwner(req: Request) {
  if (!req.user || req.user.role !== "admin") return false;
  // Fail closed unless deployment configuration selects this exact account. No automatic first-admin rule.
  const configured = process.env.COST_HEALTH_OWNER_USER_ID;
  if (!configured || String(req.user.userId) !== configured) return false;
  const operator = await operatorByUserId(req.user.userId);
  // Existing owner's legacy admin can remain in use during operator-site migration. An issued
  // operator account, if present, must also be enabled, administrator and past first-use password.
  return ownerAllowed(req.user.userId, req.user.role, configured, operator);
}
async function requireOwner(req: Request, res: Response, next: NextFunction) {
  try {
    if (!(await isOwner(req))) {
      res
        .status(403)
        .json({ error: "This page is private to the account owner." });
      return;
    }
    next();
  } catch {
    res
      .status(503)
      .json({ error: "Could not verify owner access. Try again." });
  }
}
router.use("/owner", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Pragma", "no-cache");
  next();
});
router.get("/owner/access", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json({ allowed: await isOwner(req) });
  } catch {
    res.json({ allowed: false });
  }
});
router.use("/owner/cost-health", requireAuth, requireAdmin, requireOwner);
router.get("/owner/cost-health", async (_req, res) => {
  res.json(await costDashboard());
});
router.post("/owner/cost-health/refresh", async (_req, res) => {
  await refreshCosts(true);
  res.json(await costDashboard());
});
router.patch("/owner/cost-health/settings", async (req, res) => {
  const settings = validateSettings(req.body);
  if (!settings) {
    res
      .status(400)
      .json({
        error:
          "Enter valid USD budgets between $0.01 and $100,000, with at most two decimal places. Leave the total blank if not needed.",
      });
    return;
  }
  await saveCostSettings(settings, req.user!.userId);
  recordActivity({
    userId: req.user!.userId,
    action: "owner.cost-health.settings",
    detail: { changed: true },
  });
  res.json(await costDashboard());
});
router.post("/owner/cost-health/test-email", async (req, res) => {
  const result = await sendCostTestEmail();
  if (result === "not_configured") {
    res
      .status(409)
      .json({
        error: "The alert recipient or email provider is not configured.",
      });
    return;
  }
  if (result === "rate_limited") {
    res
      .status(429)
      .json({
        error:
          "A test was already submitted. Please wait 15 minutes before trying again.",
      });
    return;
  }
  recordActivity({
    userId: req.user!.userId,
    action: "owner.cost-health.email-test",
    detail: { accepted: result === "accepted" },
  });
  res
    .status(result === "accepted" ? 200 : 502)
    .json(
      result === "accepted"
        ? { accepted: true }
        : {
            error:
              "The mail provider did not accept the test. Please retry later.",
            accepted: false,
          },
    );
});
export default router;
