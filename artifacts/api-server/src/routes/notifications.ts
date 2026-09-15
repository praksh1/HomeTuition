import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  userNotificationEventReadsTable,
  userNotificationEventsTable,
  userNotificationPrefsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { isEmailConfigured } from "../lib/mailer";
import { mergePrefs, readPrefs } from "../lib/notificationPrefs";
import { notifyUser } from "../ws/userHub";

const router: IRouter = Router();

type NotificationReadTarget =
  | { kind: "direct_message"; conversationWith: string }
  | { kind: "class_message"; batchId: string };

function text(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function readTarget(value: unknown): NotificationReadTarget | null {
  if (!value || typeof value !== "object") return null;
  const target = value as Record<string, unknown>;
  if (target.kind === "direct_message") {
    const conversationWith = text(target.conversationWith);
    return conversationWith ? { kind: "direct_message", conversationWith } : null;
  }
  if (target.kind === "class_message") {
    const batchId = text(target.batchId);
    return batchId ? { kind: "class_message", batchId } : null;
  }
  return null;
}

function eventTarget(value: unknown): NotificationReadTarget | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (event.kind === "message") {
    const conversationWith = text(event.fromUserId);
    return conversationWith ? { kind: "direct_message", conversationWith } : null;
  }
  if (event.kind === "class_message") {
    const batchId = text(event.batchId);
    return batchId ? { kind: "class_message", batchId } : null;
  }
  return null;
}

/** Events missed while this device was signed out or its socket was disconnected. */
router.get("/notification-events", requireAuth, async (req, res): Promise<void> => {
  const requested = Number(req.query.after ?? 0);
  const after = Number.isSafeInteger(requested) && requested > 0 ? requested : 0;
  const rows = await db
    .select({
      id: userNotificationEventsTable.id,
      event: userNotificationEventsTable.event,
      createdAt: userNotificationEventsTable.createdAt,
      readAt: userNotificationEventReadsTable.readAt,
    })
    .from(userNotificationEventsTable)
    .leftJoin(
      userNotificationEventReadsTable,
      eq(userNotificationEventReadsTable.eventId, userNotificationEventsTable.id),
    )
    .where(and(
      eq(userNotificationEventsTable.userId, req.user!.userId),
      gt(userNotificationEventsTable.id, after),
    ))
    .orderBy(asc(userNotificationEventsTable.id))
    .limit(200);

  // Read receipts are small account state, returned with every catch-up request so a phone
  // learns what was opened on a laptop even when no new notification has arrived. Targets are
  // included for notifications created by older app builds before server ids were stored.
  const recentReads = await db
    .select({ id: userNotificationEventsTable.id, event: userNotificationEventsTable.event })
    .from(userNotificationEventReadsTable)
    .innerJoin(
      userNotificationEventsTable,
      eq(userNotificationEventsTable.id, userNotificationEventReadsTable.eventId),
    )
    .where(eq(userNotificationEventsTable.userId, req.user!.userId))
    .orderBy(desc(userNotificationEventsTable.id))
    .limit(200);
  const targets = recentReads
    .map((row) => eventTarget(row.event))
    .filter((target): target is NotificationReadTarget => target != null);

  res.setHeader("Cache-Control", "no-store").json({
    events: rows,
    readState: { eventIds: recentReads.map((row) => row.id), targets },
  });
});

/** A read receipt belongs to the signed-in account and is shared by all of its devices. */
router.patch("/notification-events/read", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const all = body.all === true;
  const target = readTarget(body.target);
  const eventIds = Array.isArray(body.eventIds)
    ? [...new Set(body.eventIds
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 100)
    : [];

  if (!all && !target && eventIds.length === 0) {
    res.status(400).json({ error: "Choose the notification or conversation to mark as read." });
    return;
  }

  const owner = eq(userNotificationEventsTable.userId, userId);
  const scope = all
    ? owner
    : target?.kind === "direct_message"
      ? and(
          owner,
          sql`${userNotificationEventsTable.event}->>'kind' = 'message'`,
          sql`${userNotificationEventsTable.event}->>'fromUserId' = ${target.conversationWith}`,
        )
      : target?.kind === "class_message"
        ? and(
            owner,
            sql`${userNotificationEventsTable.event}->>'kind' = 'class_message'`,
            sql`${userNotificationEventsTable.event}->>'batchId' = ${target.batchId}`,
          )
        : and(owner, inArray(userNotificationEventsTable.id, eventIds));

  const owned = await db
    .select({ eventId: userNotificationEventsTable.id, userId: userNotificationEventsTable.userId })
    .from(userNotificationEventsTable)
    .where(scope);
  if (owned.length > 0) {
    await db
      .insert(userNotificationEventReadsTable)
      .values(owned)
      .onConflictDoNothing({ target: userNotificationEventReadsTable.eventId });
  }

  // Every open device updates immediately. A device that was asleep receives the same state
  // in its next durable inbox pull.
  notifyUser(userId, {
    kind: "notification_read",
    all,
    target: target ?? undefined,
    eventIds: owned.map((row) => row.eventId),
  });
  res.json({ marked: owned.length, eventIds: owned.map((row) => row.eventId) });
});

/**
 * What this user wants to be told about.
 *
 * No stored row means they have never changed anything, which is answered with the defaults
 * rather than an error — so this works for every account that existed before the feature did.
 *
 * `emailAvailable` reports whether the server can actually send email at all. The app uses it
 * to say so plainly rather than showing switches that quietly do nothing — the same rule
 * payments follow, where the mode comes from what is configured rather than from a flag.
 */
router.get("/notification-preferences", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const [row] = await db
    .select({ prefs: userNotificationPrefsTable.prefs })
    .from(userNotificationPrefsTable)
    .where(eq(userNotificationPrefsTable.userId, userId));

  res.json({
    preferences: readPrefs(row?.prefs ?? null),
    emailAvailable: isEmailConfigured(),
  });
});

router.patch("/notification-preferences", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const [row] = await db
    .select({ prefs: userNotificationPrefsTable.prefs })
    .from(userNotificationPrefsTable)
    .where(eq(userNotificationPrefsTable.userId, userId));

  const preferences = mergePrefs(row?.prefs ?? null, req.body);

  // One statement, so two devices saving at once cannot leave a user with no row at all.
  await db
    .insert(userNotificationPrefsTable)
    .values({ userId, prefs: preferences })
    .onConflictDoUpdate({
      target: userNotificationPrefsTable.userId,
      set: { prefs: preferences },
    });

  res.json({ preferences, emailAvailable: isEmailConfigured() });
});

export default router;
