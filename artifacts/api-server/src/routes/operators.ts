import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { signToken, verifyPassword } from "../lib/auth";
import { recordActivity } from "../lib/activityLog";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import { checkPassword, mayManageOperators, signInGate } from "../lib/operators";
import {
  createOperator,
  listOperators,
  operatorByLoginId,
  operatorByUserId,
  recordSignIn,
  reissueOneTimePassword,
  setOperatorDisabled,
  setOperatorPassword,
} from "../lib/operatorStore";

const router: IRouter = Router();

function callerIp(req: { headers: Record<string, unknown>; ip?: string }): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? null;
  return req.ip ?? null;
}

/**
 * Signing in to the support desk.
 *
 * Its own door, on its own site, taking an ID rather than an email — see
 * `.agents/memory/agents-log-in-separately.md` for the owner's decision and why the app's own
 * login is not it.
 *
 * Every refusal reads the same to somebody guessing: a wrong ID and a wrong password give one
 * answer, so this cannot be used to find out which operator IDs exist.
 */
router.post("/operator/login", async (req, res): Promise<void> => {
  const { loginId, password } = req.body as { loginId?: string; password?: string };
  if (!loginId || !password) {
    res.status(400).json({ error: "Enter your operator ID and password." });
    return;
  }

  const operator = await operatorByLoginId(loginId);
  const valid = operator ? await verifyPassword(password, operator.passwordHash) : false;
  if (!operator || !valid) {
    recordActivity({ action: "operator.login.refused", detail: { loginId }, ip: callerIp(req) });
    res.status(401).json({ error: "That operator ID and password do not match." });
    return;
  }

  /**
   * Switched off, or holding a one-time password that has gone stale.
   *
   * Checked after the password rather than before, for the same reason the app's own login
   * checks suspension late: answering early would let anyone discover which IDs exist and
   * which are disabled without ever knowing a password.
   */
  const gate = signInGate(operator);
  if (!gate.allowed) {
    recordActivity({
      userId: operator.userId,
      action: "operator.login.blocked",
      detail: { code: gate.code },
      ip: callerIp(req),
    });
    res.status(gate.status).json({ error: gate.reason, code: gate.code });
    return;
  }

  // A suspended user row is a separate switch from a disabled operator record, and either is
  // enough to keep somebody out.
  if (operator.suspendedAt) {
    res.status(403).json({ error: "This account is suspended.", code: "suspended" });
    return;
  }

  await recordSignIn(operator.userId);
  recordActivity({ userId: operator.userId, action: "operator.login", ip: callerIp(req) });

  res.json({
    token: signToken({ userId: operator.userId, email: operator.loginId, role: "admin" }),
    operator: {
      loginId: operator.loginId,
      name: operator.name,
      isAdministrator: operator.isAdministrator,
      /**
       * The screen uses this to send them straight to a password change. The *server* does not
       * trust it — every desk route refuses until the change actually happens, below.
       */
      mustChangePassword: operator.mustChangePassword,
    },
  });
});

/**
 * Who am I, and what am I allowed to do?
 *
 * The operator site asks this on load rather than trusting what it stored at sign-in, so that
 * an ID withdrawn mid-shift stops working on the next screen rather than at the next login.
 */
router.get("/operator/me", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const operator = await operatorByUserId(req.user!.userId);
  if (!operator) {
    res.status(403).json({ error: "This account is not an operator." });
    return;
  }
  if (operator.disabledAt) {
    res.status(403).json({ error: "This operator ID has been switched off.", code: "operator_disabled" });
    return;
  }
  res.json({
    loginId: operator.loginId,
    name: operator.name,
    isAdministrator: operator.isAdministrator,
    mustChangePassword: operator.mustChangePassword,
  });
});

/**
 * Choosing your own password, which is the only thing a new operator can do.
 *
 * The current password is required even here. Without it, a handset left unlocked on a desk is
 * a permanent takeover of that operator's account rather than an afternoon's mischief.
 */
router.post("/operator/password", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string; newPassword?: string;
  };

  const operator = await operatorByUserId(req.user!.userId);
  if (!operator) {
    res.status(403).json({ error: "This account is not an operator." });
    return;
  }

  const full = await operatorByLoginId(operator.loginId);
  if (!full || !currentPassword || !(await verifyPassword(currentPassword, full.passwordHash))) {
    res.status(401).json({ error: "That current password is not right." });
    return;
  }

  const verdict = checkPassword(String(newPassword ?? ""), operator.loginId);
  if (!verdict.ok) {
    res.status(400).json({ error: verdict.reason });
    return;
  }
  if (currentPassword === newPassword) {
    res.status(400).json({ error: "Choose a password you have not used here before." });
    return;
  }

  await setOperatorPassword(operator.userId, String(newPassword));
  // The password itself is never written to the log — only that it changed.
  recordActivity({ userId: operator.userId, action: "operator.password.changed", ip: callerIp(req) });
  res.json({ ok: true });
});

/**
 * Everything below is the administrator's, and an operator may not reach it.
 *
 * `requireAdmin` says they may work the desk. This says they may hand that power to somebody
 * else, which is a different question — an operator who can create operators can quietly give
 * themselves a second account, and every name against a support decision stops meaning
 * anything.
 */
async function requireAdministrator(req: Request, res: Response, next: NextFunction): Promise<void> {
  const operator = await operatorByUserId(req.user!.userId);
  if (!operator || !mayManageOperators(operator)) {
    // The same answer an ordinary user gets, so the existence of this screen is not confirmed
    // to an operator who is not supposed to know about it.
    res.status(403).json({ error: "You do not have access to this." });
    return;
  }
  next();
}

router.get("/operator/accounts", requireAuth, requireAdmin, requireAdministrator, async (_req, res): Promise<void> => {
  const rows = await listOperators();
  res.json({
    operators: rows.map((row) => ({
      id: row.id,
      loginId: row.loginId,
      name: row.name,
      isAdministrator: row.isAdministrator,
      // Never the password or its hash — only whether one is still waiting to be replaced.
      awaitingFirstSignIn: row.mustChangePassword,
      disabled: row.disabledAt !== null,
      lastSignInAt: row.lastSignInAt,
      createdAt: row.createdAt,
    })),
  });
});

router.post("/operator/accounts", requireAuth, requireAdmin, requireAdministrator, async (req, res): Promise<void> => {
  const { loginId, name, isAdministrator } = req.body as {
    loginId?: string; name?: string; isAdministrator?: boolean;
  };

  const made = await createOperator({
    loginId: String(loginId ?? ""),
    name: String(name ?? ""),
    isAdministrator: isAdministrator === true,
    createdBy: req.user!.userId,
  });

  if (!made.ok) {
    res.status(made.status).json({ error: made.reason });
    return;
  }

  recordActivity({
    userId: req.user!.userId,
    action: "operator.created",
    subjectType: "operator",
    subjectId: made.userId,
    // The login ID is recorded; the password never is.
    detail: { loginId: made.loginId, isAdministrator: isAdministrator === true },
    ip: callerIp(req),
  });

  /**
   * The one and only time this password is readable.
   *
   * Only its hash was stored, so there is no second chance and no lookup — if the
   * administrator loses it before handing it over, they reissue.
   */
  res.status(201).json({
    loginId: made.loginId,
    oneTimePassword: made.oneTimePassword,
    shownOnce: true,
  });
});

router.post("/operator/accounts/:id/password", requireAuth, requireAdmin, requireAdministrator, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid operator id" }); return; }

  const reissued = await reissueOneTimePassword(id);
  if (!reissued.ok) { res.status(reissued.status).json({ error: reissued.reason }); return; }

  recordActivity({
    userId: req.user!.userId,
    action: "operator.password.reissued",
    subjectType: "operator",
    subjectId: id,
    ip: callerIp(req),
  });

  res.json({ loginId: reissued.loginId, oneTimePassword: reissued.oneTimePassword, shownOnce: true });
});

router.post("/operator/accounts/:id/disabled", requireAuth, requireAdmin, requireAdministrator, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid operator id" }); return; }

  const disabled = (req.body as { disabled?: boolean }).disabled !== false;
  const done = await setOperatorDisabled(id, disabled, req.user!.userId);
  if (!done.ok) { res.status(done.status).json({ error: done.reason }); return; }

  recordActivity({
    userId: req.user!.userId,
    action: disabled ? "operator.disabled" : "operator.reinstated",
    subjectType: "operator",
    subjectId: id,
    ip: callerIp(req),
  });

  res.json({ ok: true, disabled });
});

export default router;
