import { Router, type IRouter } from "express";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db, sessionProviderEventsTable, sessionQualitySamplesTable, sessionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { getSessionMembership, JOIN_WINDOW_MINUTES } from "../lib/membership";
import { normalizeDailyEvent } from "../lib/sessionProof/providerEvents";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  isActivationProbe,
  verifyWebhookSignature,
} from "../lib/sessionProof/webhookSignature";
import {
  MAX_SAMPLES_PER_SESSION_PER_USER,
  MIN_SECONDS_BETWEEN_REQUESTS,
  observationWindow,
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
 * How far outside a class's own times a provider event may sit and still be that class's.
 *
 * Twelve hours, which is far wider than any real lesson overrun and far narrower than "some other
 * day". It exists because a Daily room named `sikshya42` maps to session 42 by name alone: if a
 * room outlives its class, or somebody opens it by hand, its events would otherwise attach to a
 * lesson they have nothing to do with and stretch its recorded span across the gap.
 *
 * An event outside it is stored **unattached** rather than dropped, keeping its room name, so an
 * operator asking "why is there no provider evidence for this class" can see events arriving and
 * failing to correlate. That difference — nothing arriving versus nothing correlating — is exactly
 * what a silent parser hides.
 */
const CLASS_CORRELATION_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Every reply this endpoint gives a provider, so the shapes are decided in one place. */
type WebhookOutcome = { received: true; stored: boolean; duplicate?: boolean };

/**
 * Daily's webhook.
 *
 * ## Every failure mode here is "say little, break nothing"
 *
 * A webhook endpoint is unauthenticated by definition — anybody can post to it — so it is written
 * to be uninteresting to probe and impossible to use as a lever on a live class.
 *
 * - **The activation probe** is answered 200 before anything else, unsigned, storing nothing. See
 *   `isActivationProbe`: Daily returns the signing secret from the same call that fires the probe,
 *   so demanding a signature here is a deadlock in which the endpoint can never be activated at
 *   all. Configured and unconfigured deployments answer it identically, so it discloses nothing.
 * - **Not configured** answers 404 for anything else, exactly as an unknown path would. Not 503
 *   and not "webhook secret missing": a response that distinguishes "configured but wrong
 *   signature" from "not configured" tells a prober whether this deployment ingests webhooks, and
 *   naming the variable tells them what to look for.
 * - **Bad or stale signature** answers 401 with the same flat body. Safe to be a hard failure:
 *   Daily never sends an incorrectly signed body, so a 401 can only ever be somebody else's.
 * - **Anything verified but not stored** answers **200**, not 4xx. Daily deactivates a webhook
 *   whose endpoint keeps failing, so a body this product chooses to ignore — an event type it does
 *   not use, a room that is not a class, a class that does not exist — must not look like a fault.
 * - **Duplicate** answers 200 too. The unique index does the work; a retried delivery is normal.
 * - **Nothing here touches a classroom.** No socket is written, no session row is updated, no
 *   notification is sent. The worst a hostile caller holding the signing secret could do is add
 *   rows to an evidence table an operator reads with the source labelled.
 */
router.post("/webhooks/daily", async (req, res): Promise<void> => {
  /*
    The activation probe, first and unsigned.

    Order is the whole point. Creating the webhook is what *returns* the secret, and the probe is
    fired during that same call, so at this moment there is nothing to verify against — on a
    deployment where `DAILY_WEBHOOK_SECRET` is by definition not yet set. Every check below would
    refuse it, and the endpoint could never be turned on.

    Answering costs nothing: exactly the body `{"test":"test"}`, nothing stored, nothing read, no
    class touched.
  */
  if (isActivationProbe(req.body)) {
    req.log?.info("answered a Daily webhook activation probe; nothing was stored");
    res.status(200).json({ received: true, stored: false } satisfies WebhookOutcome);
    return;
  }

  const secret = webhookSecret();
  if (!secret) {
    req.log?.warn("a Daily webhook arrived but ingestion is not configured on this deployment");
    res.status(404).json({ error: "Not found" });
    return;
  }

  const verified = verifyWebhookSignature({
    secret,
    timestamp: req.get(TIMESTAMP_HEADER),
    signature: req.get(SIGNATURE_HEADER),
    body: req.body,
    nowMs: Date.now(),
  });
  if (!verified.ok) {
    // The reason is logged and never returned. Telling a caller which check it failed is a free
    // oracle for passing the next one.
    req.log?.warn({ reason: verified.reason }, "a Daily webhook failed verification");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const normalized = normalizeDailyEvent(req.body);
  if (!normalized.ok) {
    req.log?.info({ reason: normalized.reason }, "a Daily webhook was verified but not storable");
    res.status(200).json({ received: true, stored: false } satisfies WebhookOutcome);
    return;
  }

  const event = normalized.event;

  try {
    /*
      Does this class exist, and could this event be its own?

      Without this, a signed event for `sikshya999999` parses cleanly, correlates to session
      999999, and fails a foreign key on insert — a 500, which the provider retries on a schedule
      forever for a row that can never be written.
    */
    const [session] = await db
      .select({ id: sessionsTable.id, date: sessionsTable.date, duration: sessionsTable.duration })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, event.sessionId!));

    if (!session) {
      // Not an error and not stored: a room named for a class this deployment has never had is
      // somebody else's or a leftover, and attaching it to nothing is the honest outcome.
      req.log?.info(
        { room: event.providerRoom, type: event.eventType },
        "a verified Daily event named a room whose class does not exist here; not stored",
      );
      res.status(200).json({ received: true, stored: false } satisfies WebhookOutcome);
      return;
    }

    const scheduledMs = new Date(session.date).getTime();
    const windowFrom = scheduledMs - CLASS_CORRELATION_WINDOW_MS;
    const windowTo = scheduledMs + session.duration * 60_000 + CLASS_CORRELATION_WINDOW_MS;
    const withinClassWindow = event.eventAtMs >= windowFrom && event.eventAtMs <= windowTo;
    if (!withinClassWindow) {
      req.log?.warn(
        { room: event.providerRoom, type: event.eventType, sessionId: session.id },
        "a verified Daily event fell outside its class's window; storing it unattached",
      );
    }

    /*
      The provider's claim about *who* joined, checked against this project's own membership.

      A `user_id` on a provider event is a number that came back from outside. It is almost
      certainly one this server minted into a token, but "almost certainly" is not the standard for
      a row an operator will read as "this teacher was in the room" — and a room name collision, a
      reused token or a forged payload all look identical at this point.

      `getSessionMembership` is the single place this project answers "may this user be in this
      class?" (CLAUDE.md), so it is what decides. Anything it does not recognise is discarded and
      the discard is recorded, because a stream of unrecognised claims is a real signal and an
      invisible one if bad ids are quietly blanked.
    */
    let participantUserId: number | null = null;
    let identityRejected: boolean | null = null;
    if (event.participantUserId !== null) {
      const claimed = await getSessionMembership(session.id, event.participantUserId);
      const belongs =
        claimed !== null &&
        (claimed.isSessionTeacher || claimed.isEnrolledStudent || claimed.wasRefunded);
      if (belongs && withinClassWindow) {
        participantUserId = event.participantUserId;
        identityRejected = false;
      } else {
        identityRejected = true;
        req.log?.warn(
          { sessionId: session.id, type: event.eventType },
          "a verified Daily event named a user who is not part of that class; the id was discarded",
        );
      }
    }

    const inserted = await db
      .insert(sessionProviderEventsTable)
      .values({
        provider: event.provider,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        eventAt: new Date(event.eventAtMs),
        eventAtSource: event.eventAtSource,
        // Never attached to a class the event could not belong to. The room name is kept either
        // way, so an uncorrelated event is still diagnosable.
        sessionId: withinClassWindow ? session.id : null,
        providerRoom: event.providerRoom,
        providerMeetingId: event.providerMeetingId,
        providerParticipantId: event.providerParticipantId,
        participantUserId,
        identityRejected,
        participantIsOwner: event.participantIsOwner,
        durationSeconds: event.durationSeconds,
      })
      /*
        Idempotency, decided by the database, against **either** of two keys.

        No conflict target on purpose. There are two unique indexes on this table and a delivery
        may collide with either:

        - `(provider, provider_event_id)` — the same delivery arriving twice.
        - `(provider, event_type, provider_participant_id)`, partial — the case Daily explicitly
          warns about, where a duplicate `participant.joined` or `participant.left` arrives under a
          *different* event id. Naming only the first target would let those through: two rows, two
          ids, one arrival, and a person's comings and goings counted twice in the evidence for a
          refund.

        A bare `ON CONFLICT DO NOTHING` covers both, and it needs no read, so two concurrent
        deliveries cannot both win a read-then-write.
      */
      .onConflictDoNothing()
      .returning({ id: sessionProviderEventsTable.id });

    res.status(200).json({
      received: true,
      stored: inserted.length > 0,
      duplicate: inserted.length === 0,
    } satisfies WebhookOutcome);
  } catch (err) {
    /*
      A failure here must not become the provider's problem, and must never reach a classroom.

      500 rather than 200 so a genuine outage — a database that is down, a table that does not
      exist yet — is retried. Everything this endpoint *chooses* not to store answers 200 above,
      so a retry here means something is actually broken. The class this event describes is
      unaffected either way: the socket ledger is the primary record and does not depend on any of
      this.
    */
    req.log?.error({ err }, "could not store a verified Daily event");
    res.status(500).json({ error: "Could not store the event" });
  }
});

/* ---------------------------------------------------------------- the participant's account */

/**
 * Coarse connection quality, reported by a participant's own device.
 *
 * Authenticated, membership-checked, bounded, serialised and rate-limited — in that order, and
 * every one of them because this is the only place in the product where a party to a dispute
 * writes to the evidence about it.
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
    The window a sample may claim: the class's own times, and nothing else.

    `observationWindow` holds the rule and the history of getting it wrong. It is pure and takes
    the clock as an argument, so "a class from three months ago rejects a timestamp from today" is
    a test rather than a hope.
  */
  if (!membership.scheduledFor) {
    // No scheduled time means no window, and an unbounded window is exactly the bug being fixed.
    // Refused rather than guessed: a class with no date cannot be the subject of a timeline.
    res.status(409).json({ error: "This class has no scheduled time to record against." });
    return;
  }
  const { accepted, rejected, truncated } = sanitiseQualitySamples(
    req.body?.samples,
    observationWindow({
      scheduledStartMs: membership.scheduledFor.getTime(),
      durationMinutes: membership.duration,
      doorsOpenMinutes: JOIN_WINDOW_MINUTES,
      nowMs: Date.now(),
    }),
  );

  if (accepted.length === 0) {
    res.json({ stored: 0, rejected, truncated });
    return;
  }

  try {
    /*
      One transaction, and one writer per person per class at a time.

      The cap and the rate limit are read from what is already stored, so they survive a restart
      and cannot be reset by reconnecting — but a read-then-write races itself. Ten parallel posts
      from one device all read the same count, all see room, and all insert: the 500-sample cap
      becomes a suggestion and the ten-second rate limit never fires. That is precisely the shape a
      party to a dispute would exploit to bury a class in self-reported evidence.

      `pg_advisory_xact_lock` serialises them on (session, user) for the length of the transaction.
      It is per-pair rather than global, so two people in the same class never wait on each other,
      and it is released by commit or rollback with nothing to clean up.
    */
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${sessionId}, ${req.user!.userId})`);

      const [existing] = await tx
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
        return { refused: "cap" as const };
      }
      const latest = existing?.latest ? new Date(existing.latest).getTime() : null;
      if (latest !== null && Date.now() - latest < MIN_SECONDS_BETWEEN_REQUESTS * 1000) {
        return { refused: "rate" as const };
      }

      const room = Math.max(0, MAX_SAMPLES_PER_SESSION_PER_USER - already);
      const toStore = accepted.slice(0, room);

      await tx.insert(sessionQualitySamplesTable).values(
        toStore.map((sample) => ({
          sessionId,
          userId: req.user!.userId,
          role,
          quality: sample.quality,
          reconnect: sample.reconnect,
          observedAt: new Date(sample.observedAtMs),
        })),
      );

      return { stored: toStore.length };
    });

    if ("refused" in outcome) {
      res.status(429).json({
        error: outcome.refused === "cap"
          ? "Enough connection reports have been recorded for this class."
          : "Too many connection reports. Try again shortly.",
      });
      return;
    }

    res.json({ stored: outcome.stored, rejected, truncated });
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

/** One provider event, as the aggregate needs it. */
export interface StoredProviderEventRow {
  eventType: string;
  eventAt: Date;
  eventAtSource: string;
  /**
   * The provider's id for the meeting *instance*.
   *
   * Carried rather than dropped because a room can hold several meetings — a call that drops and
   * is rejoined starts a new one — and a span measured from the earliest start to the latest end
   * across two of them bills the gap between as teaching.
   */
  providerMeetingId: string | null;
  participantUserId: number | null;
  identityRejected: boolean | null;
  participantIsOwner: boolean | null;
  durationSeconds: number | null;
}

/** Provider events for one class, oldest first. Empty array and "unavailable" are different. */
export async function providerEventsFor(sessionId: number): Promise<{
  known: boolean;
  rows: StoredProviderEventRow[];
}> {
  try {
    const rows = await db
      .select({
        eventType: sessionProviderEventsTable.eventType,
        eventAt: sessionProviderEventsTable.eventAt,
        eventAtSource: sessionProviderEventsTable.eventAtSource,
        providerMeetingId: sessionProviderEventsTable.providerMeetingId,
        participantUserId: sessionProviderEventsTable.participantUserId,
        identityRejected: sessionProviderEventsTable.identityRejected,
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
