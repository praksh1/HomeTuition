import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db, sessionProviderEventsTable, sessionQualitySamplesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { getSessionMembership } from "../lib/membership";
import { normalizeDailyEvent } from "../lib/sessionProof/providerEvents";
import {
  MAX_SAMPLES_PER_SESSION_PER_USER,
  MIN_SECONDS_BETWEEN_REQUESTS,
  sanitiseQualitySamples,
} from "../lib/sessionProof/telemetryBounds";

const router: IRouter = Router();

/* ------------------------------------------------------------------ the provider's account */

/**
 * The signing secret, or null.
 *
 * Configuration by environment only. There is deliberately no admin screen, no database row and no
 * default: a webhook secret that can be set through the product is a webhook secret that can be
 * read through the product.
 */
function webhookSecret(): string | null {
  const secret = process.env.DAILY_WEBHOOK_SECRET;
  return typeof secret === "string" && secret.trim().length > 0 ? secret.trim() : null;
}

/**
 * HMAC-SHA256 over the exact bytes the provider sent.
 *
 * The raw body matters and is already captured for the payment webhook — `app.ts` stashes it in
 * `req.rawBody` before parsing, because re-serialising parsed JSON reorders keys and changes
 * spacing, producing a different digest and rejecting every genuine callback.
 */
function signatureMatches(rawBody: string, given: string | undefined, secret: string): boolean {
  if (!given) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given.trim().replace(/^sha256=/i, ""), "utf8");
  // Length is checked first because timingSafeEqual throws on a mismatch; comparing lengths leaks
  // only the length, which is fixed for a hex digest anyway.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Daily's webhook.
 *
 * ## Every failure mode here is "say little, break nothing"
 *
 * A webhook endpoint is unauthenticated by definition — anybody can post to it — so it is written
 * to be uninteresting to probe and impossible to use as a lever on a live class.
 *
 * - **Not configured** answers 404, exactly as an unknown path would. Not 503 and not "webhook
 *   secret missing": a response that distinguishes "configured but wrong signature" from "not
 *   configured" tells a prober whether this deployment ingests webhooks at all, and naming the
 *   variable tells them what to look for. The route logs the reason; the caller learns nothing.
 * - **Bad signature** answers 401 with the same flat body.
 * - **Malformed or uncorrelated** answers 202. It is accepted-and-ignored rather than 400, because
 *   a 4xx makes a provider retry the same unparseable body on a schedule for hours.
 * - **Duplicate** answers 200. The unique index does the work; a retried delivery is a normal
 *   event, not an error.
 * - **Nothing here touches a classroom.** No socket is written, no session row is updated, no
 *   notification is sent. The worst a hostile caller with a valid signature could do is add rows to
 *   an evidence table that an operator reads with the source labelled.
 */
router.post("/webhooks/daily", async (req, res): Promise<void> => {
  const secret = webhookSecret();
  if (!secret) {
    req.log?.warn("a Daily webhook arrived but ingestion is not configured on this deployment");
    res.status(404).json({ error: "Not found" });
    return;
  }

  const rawBody = (req as { rawBody?: string }).rawBody;
  if (typeof rawBody !== "string") {
    // Without the exact bytes there is nothing to verify against, and re-serialising would produce
    // a digest that never matches.
    req.log?.warn("a Daily webhook arrived without a raw body to verify");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const header = req.get("x-daily-signature") ?? req.get("x-webhook-signature");
  if (!signatureMatches(rawBody, header, secret)) {
    req.log?.warn("a Daily webhook failed signature verification");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const normalized = normalizeDailyEvent(req.body);
  if (!normalized.ok) {
    // Counted, never echoed. Telling a caller *why* its payload was rejected is a free oracle for
    // shaping one that is not.
    req.log?.info({ reason: normalized.reason }, "a Daily webhook was verified but not storable");
    res.status(202).json({ accepted: true, stored: false });
    return;
  }

  const event = normalized.event;
  try {
    const inserted = await db
      .insert(sessionProviderEventsTable)
      .values({
        provider: event.provider,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        eventAt: new Date(event.eventAtMs),
        sessionId: event.sessionId,
        providerRoom: event.providerRoom,
        providerMeetingId: event.providerMeetingId,
        providerParticipantId: event.providerParticipantId,
        participantUserId: event.participantUserId,
        participantIsOwner: event.participantIsOwner,
        durationSeconds: event.durationSeconds,
      })
      // Idempotency, decided by the database. Two concurrent deliveries of one event cannot both
      // win a read-then-write, and this needs no read at all.
      .onConflictDoNothing({
        target: [sessionProviderEventsTable.provider, sessionProviderEventsTable.providerEventId],
      })
      .returning({ id: sessionProviderEventsTable.id });

    res.json({ accepted: true, stored: inserted.length > 0, duplicate: inserted.length === 0 });
  } catch (err) {
    /*
      A failure here must not become the provider's problem, and must never reach a classroom.

      500 rather than 200 so a genuine outage is retried, but the class this event describes is
      entirely unaffected either way: the socket ledger is the primary record and does not depend
      on any of this.
    */
    req.log?.error({ err }, "could not store a verified Daily event");
    res.status(500).json({ error: "Could not store the event" });
  }
});

/* ---------------------------------------------------------------- the participant's account */

/**
 * Coarse connection quality, reported by a participant's own device.
 *
 * Authenticated, membership-checked, bounded and rate-limited — in that order, and every one of
 * them because this is the only place in the product where a party to a dispute writes to the
 * evidence about it.
 *
 * **Membership comes from `getSessionMembership`, never from the body.** That function is the one
 * place this project answers "may this user be in this class?", and CLAUDE.md is explicit that it
 * must not be re-implemented anywhere. It also supplies the role, so a student cannot file
 * connection trouble as the teacher.
 */
router.post("/sessions/:id/quality", requireAuth, async (req, res): Promise<void> => {
  const sessionId = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(sessionId)) { res.status(400).json({ error: "Invalid session id" }); return; }

  const membership = await getSessionMembership(sessionId, req.user!.userId);
  if (!membership) { res.status(404).json({ error: "Session not found" }); return; }
  /*
    Enrolled or teaching. Deliberately not `canAccessSession`, which also gates on the join window:
    a device reporting a bad line just after a class ends is exactly when it would, and refusing
    that would discard the reports most relevant to a dispute.

    `wasRefunded` is accepted too. Somebody who dropped the class was in it, and their account of
    why the line was bad is often the evidence for the drop.
  */
  if (!membership.isSessionTeacher && !membership.isEnrolledStudent && !membership.wasRefunded) {
    res.status(403).json({ error: "You are not part of this class" });
    return;
  }

  // The role is the server's answer, never the client's. A student must not be able to file
  // connection trouble as the teacher in their own dispute.
  const role = membership.isSessionTeacher ? "teacher" : "student";

  /*
    The window a sample may claim. Sanitising against the class's own times rather than "recently"
    is what stops a device backdating trouble into a lesson it was not in.
  */
  const startMs = membership.scheduledFor ? membership.scheduledFor.getTime() : Date.now();
  const endMs = startMs + membership.duration * 60_000;
  const { accepted, rejected, truncated } = sanitiseQualitySamples(req.body?.samples, {
    fromMs: startMs,
    toMs: Math.max(endMs, Date.now()),
  });

  if (accepted.length === 0) {
    res.json({ stored: 0, rejected, truncated });
    return;
  }

  try {
    // Rate limit and per-session cap, both read from what is already stored rather than from
    // memory, so they survive a restart and cannot be reset by reconnecting.
    const [existing] = await db
      .select({
        total: count(),
        latest: sql<Date | null>`max(${sessionQualitySamplesTable.receivedAt})`,
      })
      .from(sessionQualitySamplesTable)
      .where(and(
        eq(sessionQualitySamplesTable.sessionId, sessionId),
        eq(sessionQualitySamplesTable.userId, req.user!.userId),
      ));

    const already = existing?.total ?? 0;
    if (already >= MAX_SAMPLES_PER_SESSION_PER_USER) {
      res.status(429).json({ error: "Enough connection reports have been recorded for this class." });
      return;
    }
    const latest = existing?.latest ? new Date(existing.latest).getTime() : null;
    if (latest !== null && Date.now() - latest < MIN_SECONDS_BETWEEN_REQUESTS * 1000) {
      res.status(429).json({ error: "Too many connection reports. Try again shortly." });
      return;
    }

    const room = Math.max(0, MAX_SAMPLES_PER_SESSION_PER_USER - already);
    const toStore = accepted.slice(0, room);

    await db.insert(sessionQualitySamplesTable).values(
      toStore.map((sample) => ({
        sessionId,
        userId: req.user!.userId,
        role,
        quality: sample.quality,
        reconnect: sample.reconnect,
        observedAt: new Date(sample.observedAtMs),
      })),
    );

    res.json({ stored: toStore.length, rejected, truncated });
  } catch (err) {
    /*
      Telemetry is the least important thing in this product and must behave like it.

      A failure is logged and answered 200 with `stored: 0`: a client that gets a 500 will retry,
      and a retry storm from every device in a class over a table nobody needs in real time is a
      worse outcome than losing a sample. The class is unaffected either way.
    */
    req.log?.warn({ err }, "could not store connection quality samples");
    res.json({ stored: 0, rejected, truncated });
  }
});

export default router;

/* --------------------------------------------------------------------------- reading it back */

/** Provider events for one class, oldest first. Empty array and "unavailable" are different. */
export async function providerEventsFor(sessionId: number): Promise<{
  known: boolean;
  rows: { eventType: string; eventAt: Date; participantUserId: number | null; participantIsOwner: boolean | null; durationSeconds: number | null }[];
}> {
  try {
    const rows = await db
      .select({
        eventType: sessionProviderEventsTable.eventType,
        eventAt: sessionProviderEventsTable.eventAt,
        participantUserId: sessionProviderEventsTable.participantUserId,
        participantIsOwner: sessionProviderEventsTable.participantIsOwner,
        durationSeconds: sessionProviderEventsTable.durationSeconds,
      })
      .from(sessionProviderEventsTable)
      .where(eq(sessionProviderEventsTable.sessionId, sessionId))
      .orderBy(sessionProviderEventsTable.eventAt)
      .limit(2000);
    return { known: true, rows };
  } catch {
    // `known: false` is the whole point: the table may not exist yet on a deployment where
    // `db:push` has not run, and an empty list would read as "the provider saw nothing".
    return { known: false, rows: [] };
  }
}

/** Quality samples for one class. Same unavailable-versus-empty contract. */
export async function qualitySamplesFor(sessionId: number): Promise<{
  known: boolean;
  rows: { userId: number; observedAt: Date; quality: string; reconnect: boolean }[];
}> {
  try {
    const rows = await db
      .select({
        userId: sessionQualitySamplesTable.userId,
        observedAt: sessionQualitySamplesTable.observedAt,
        quality: sessionQualitySamplesTable.quality,
        reconnect: sessionQualitySamplesTable.reconnect,
      })
      .from(sessionQualitySamplesTable)
      .where(eq(sessionQualitySamplesTable.sessionId, sessionId))
      .orderBy(desc(sessionQualitySamplesTable.observedAt))
      .limit(2000);
    return { known: true, rows };
  } catch {
    return { known: false, rows: [] };
  }
}
