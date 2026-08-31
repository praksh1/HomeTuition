import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  studentProfilesTable,
  teacherProfilesTable,
  userOnboardingTable,
  usersTable,
} from "@workspace/db";

import locationData from "../data/nepalEducationFacilities.json";
import { requireAuth } from "../middlewares/requireAuth";
import { deleteUpload, signView, verifyUpload } from "../lib/fileStore";
import { flagContent } from "../lib/moderation";
import { ageOn } from "../lib/onboardingRules";

const router: IRouter = Router();

type District = { name: string; localLevels: string[] };
type Province = { name: string; districts: District[] };
type Facility = [number, string, string, string, string, string];
const provinces = locationData.provinces as Province[];
const facilities = locationData.facilities as Facility[];

router.get("/locations/nepal", (_req, res): void => {
  res.json({ provinces, manualOption: "Not specified" });
});

router.get("/locations/nepal/facilities", (req, res): void => {
  const province = String(req.query.province ?? "").trim();
  const district = String(req.query.district ?? "").trim();
  const localLevel = String(req.query.localLevel ?? "").trim();
  const query = String(req.query.q ?? "").trim().toLocaleLowerCase();
  if (!province || !district || query.length < 2) {
    res.status(400).json({ error: "Choose a province and district, then type at least two letters." });
    return;
  }
  const provinceIndex = provinces.findIndex((item) => item.name === province);
  if (provinceIndex < 0) { res.json({ facilities: [] }); return; }
  const matches = facilities
    .filter((row) =>
      row[0] === provinceIndex && row[1] === district && (!localLevel || row[2] === localLevel) &&
      `${row[3]} ${row[4]}`.toLocaleLowerCase().includes(query),
    )
    .slice(0, 25)
    .map((row) => ({ district: row[1], localLevel: row[2], name: row[3], nepaliName: row[4] || null, type: row[5] || null }));
  res.json({ facilities: matches });
});

router.get("/onboarding/me", requireAuth, async (req, res): Promise<void> => {
  const [row] = await db.select().from(userOnboardingTable).where(eq(userOnboardingTable.userId, req.user!.userId));
  res.json({ onboarding: row ?? null });
});

router.patch("/onboarding/me", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const text = (name: string): string | null => typeof req.body?.[name] === "string" ? req.body[name].trim() : null;
  const phone = text("phone");
  const province = text("province");
  const district = text("district");
  const localLevel = text("localLevel");
  const locality = text("locality");
  const institutionName = text("institutionName");
  const affiliationStatus = text("affiliationStatus");
  const dateOfBirth = text("dateOfBirth");
  const guardianName = text("guardianName");
  const guardianEmail = text("guardianEmail");
  const guardianPhone = text("guardianPhone");
  const guardianRelationship = text("guardianRelationship");
  const [existing] = await db.select().from(userOnboardingTable).where(eq(userOnboardingTable.userId, user.userId));

  if (!phone || !province || !district || !localLevel) {
    res.status(400).json({ error: "Phone, province, district, and municipality/local level are required." });
    return;
  }
  if (!/^\+?[0-9][0-9 -]{6,17}$/.test(phone)) {
    res.status(400).json({ error: "Enter a valid phone number." });
    return;
  }
  if (!affiliationStatus || !["affiliated", "independent", "not_specified"].includes(affiliationStatus)) {
    res.status(400).json({ error: "Choose your school affiliation." });
    return;
  }
  if (affiliationStatus !== "independent" && !institutionName) {
    res.status(400).json({ error: "Choose a school or enter its name." });
    return;
  }

  if (user.role === "student") {
    const savedDateOfBirth = dateOfBirth ?? existing?.dateOfBirth ?? null;
    const savedGuardianName = guardianName ?? existing?.guardianName ?? null;
    const savedGuardianEmail = guardianEmail ?? existing?.guardianEmail ?? null;
    const savedGuardianPhone = guardianPhone ?? existing?.guardianPhone ?? null;
    const savedGuardianRelationship = guardianRelationship ?? existing?.guardianRelationship ?? null;
    const age = savedDateOfBirth ? ageOn(savedDateOfBirth) : null;
    if (age === null) { res.status(400).json({ error: "Enter a valid date of birth." }); return; }
    if (age < 18 && (!savedGuardianName || !savedGuardianEmail || !savedGuardianPhone || !savedGuardianRelationship)) {
      res.status(400).json({ error: "A parent or guardian must provide their name, email, phone, and relationship for a student under 18." });
      return;
    }
  }

  const values = {
    dateOfBirth: user.role === "student" ? dateOfBirth ?? existing?.dateOfBirth ?? null : null,
    phone,
    province,
    district,
    localLevel,
    locality,
    institutionName: affiliationStatus === "independent" ? null : institutionName,
    affiliationStatus,
    guardianName: user.role === "student" ? guardianName ?? existing?.guardianName ?? null : null,
    guardianEmail: user.role === "student" ? (guardianEmail ?? existing?.guardianEmail)?.toLocaleLowerCase() ?? null : null,
    guardianPhone: user.role === "student" ? guardianPhone ?? existing?.guardianPhone ?? null : null,
    guardianRelationship: user.role === "student" ? guardianRelationship ?? existing?.guardianRelationship ?? null : null,
    completedAt: existing?.profilePhotoKey || user.role === "student" ? new Date() : null,
    updatedAt: new Date(),
  };
  const [saved] = existing
    ? await db.update(userOnboardingTable).set(values).where(eq(userOnboardingTable.userId, user.userId)).returning()
    : await db.insert(userOnboardingTable).values({ userId: user.userId, ...values }).returning();

  await flagContent({ userId: user.userId, surface: "institution_name", text: institutionName ?? "" });
  if (user.role === "teacher") {
    await db.update(teacherProfilesTable).set({ location: locality || localLevel, district }).where(eq(teacherProfilesTable.userId, user.userId));
  }
  res.json({ onboarding: saved });
});

router.post("/onboarding/me/profile-photo", requireAuth, async (req, res): Promise<void> => {
  const fileKey = typeof req.body?.fileKey === "string" ? req.body.fileKey.trim() : "";
  if (!fileKey) { res.status(400).json({ error: "Select and upload a face photo." }); return; }
  const verdict = await verifyUpload(fileKey, req.user!.userId);
  if (!verdict.ok) { res.status(400).json({ error: verdict.reason }); return; }
  if (!verdict.contentType.startsWith("image/")) {
    await deleteUpload(fileKey);
    res.status(400).json({ error: "Your profile picture must be an image." });
    return;
  }
  const [existing] = await db.select().from(userOnboardingTable).where(eq(userOnboardingTable.userId, req.user!.userId));
  const [saved] = existing
    ? await db.update(userOnboardingTable).set({ profilePhotoKey: fileKey, updatedAt: new Date() }).where(eq(userOnboardingTable.userId, req.user!.userId)).returning()
    : await db.insert(userOnboardingTable).values({ userId: req.user!.userId, profilePhotoKey: fileKey }).returning();
  if (existing?.profilePhotoKey && existing.profilePhotoKey !== fileKey) await deleteUpload(existing.profilePhotoKey);
  res.json({ onboarding: saved });
});

router.get("/profiles/:userId/photo", async (req, res): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) { res.status(400).json({ error: "Invalid profile." }); return; }
  const [row] = await db
    .select({ key: userOnboardingTable.profilePhotoKey, role: usersTable.role })
    .from(userOnboardingTable)
    .innerJoin(usersTable, eq(usersTable.id, userOnboardingTable.userId))
    .where(and(eq(userOnboardingTable.userId, userId), eq(usersTable.role, "teacher")));
  if (!row?.key) { res.status(404).json({ error: "No profile photo." }); return; }
  const url = await signView(row.key);
  if (!url) { res.status(503).json({ error: "Profile photos are not available." }); return; }
  res.json({ url });
});

export default router;
