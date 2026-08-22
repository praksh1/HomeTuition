import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, disputeReasonEnum, disputesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { getSessionMembership } from "../lib/membership";

const router: IRouter = Router();

const VALID_REASONS = new Set<string>(disputeReasonEnum.enumValues);

router.post("/disputes", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { reason, description, evidenceUrl, sessionId } = req.body as {
    reason?: string; description?: string; evidenceUrl?: string | null; sessionId?: number;
  };

  if (!reason || !VALID_REASONS.has(reason)) {
    res.status(400).json({ error: `reason must be one of: ${[...VALID_REASONS].join(", ")}` });
    return;
  }
  if (!description || !description.trim()) {
    res.status(400).json({ error: "description is required" });
    return;
  }

  /**
   * A report may name the class it is about, and then it must be a class the reporter was
   * actually part of.
   *
   * Without this check anybody could file a complaint against any class in the system, and
   * that complaint would be read against that class's attendance record — somebody else's
   * lesson, somebody else's teacher, and a reviewer with no way to see that the person
   * complaining was never there.
   */
  let about: number | null = null;
  if (sessionId !== undefined && sessionId !== null) {
    const id = Number(sessionId);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "sessionId must be a number" });
      return;
    }
    const membership = await getSessionMembership(id, userId);
    if (!membership || (!membership.isSessionTeacher && !membership.hasPaid)) {
      res.status(403).json({ error: "You can only report a class you took part in." });
      return;
    }
    about = id;
  }

  /**
   * A file is required only when there is nothing else to go on.
   *
   * A report that names a class does not need one: the server's own record of who was in that
   * room, and when, is better evidence than a photograph and neither side can edit it. Making
   * it mandatory for everybody locked out exactly the person it should have served most — a
   * student whose teacher never arrived, with nothing to photograph.
   */
  const evidence = typeof evidenceUrl === "string" ? evidenceUrl.trim() : "";
  if (!evidence && about === null) {
    res.status(400).json({ error: "Please attach a file, or report this from the class it is about." });
    return;
  }

  const [dispute] = await db.insert(disputesTable).values({
    userId,
    sessionId: about,
    reason: reason as typeof disputeReasonEnum.enumValues[number],
    description: description.trim(),
    evidenceUrl: evidence || null,
  }).returning();

  res.status(201).json(dispute);
});

router.get("/disputes/mine", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const rows = await db.select().from(disputesTable)
    .where(eq(disputesTable.userId, userId))
    .orderBy(desc(disputesTable.createdAt));
  res.json(rows);
});

export default router;
