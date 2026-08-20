import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, userNotificationPrefsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { isEmailConfigured } from "../lib/mailer";
import { mergePrefs, readPrefs } from "../lib/notificationPrefs";

const router: IRouter = Router();

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
