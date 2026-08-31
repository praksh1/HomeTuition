import { eq } from "drizzle-orm";
import { db, teacherProfilesTable } from "@workspace/db";

import { emailVerifiedFor } from "./accountSecurity";

export type TeachingAccess =
  | { allowed: true }
  | { allowed: false; status: number; code: "EMAIL_UNVERIFIED" | "OPERATOR_REVIEW" | "PLAN_REQUIRED"; message: string };

/** The three independent doors before an ordinary class may be created. */
export async function ordinaryTeachingAccess(teacherId: number): Promise<TeachingAccess> {
  const [verified, [profile]] = await Promise.all([
    emailVerifiedFor(teacherId),
    db
      .select({ approvalStatus: teacherProfilesTable.approvalStatus, subscriptionActive: teacherProfilesTable.subscriptionActive })
      .from(teacherProfilesTable)
      .where(eq(teacherProfilesTable.userId, teacherId))
      .limit(1),
  ]);
  if (!verified) {
    return { allowed: false, status: 403, code: "EMAIL_UNVERIFIED", message: "Verify your email before creating a class." };
  }
  if (!profile || profile.approvalStatus !== "approved") {
    return {
      allowed: false,
      status: 403,
      code: "OPERATOR_REVIEW",
      message: profile?.approvalStatus === "rejected"
        ? "Your teacher verification was rejected. Correct the requested documents before creating a class."
        : "A Sikshya operator must verify your teacher account before you can create a class.",
    };
  }
  if (!profile.subscriptionActive) {
    return {
      allowed: false,
      status: 402,
      code: "PLAN_REQUIRED",
      message: "Choose and pay for a teaching plan before creating a class.",
    };
  }
  return { allowed: true };
}

/** Email and operator review gate buying any teacher plan. */
export async function mayBuyTeacherPlan(teacherId: number): Promise<TeachingAccess> {
  const [verified, [profile]] = await Promise.all([
    emailVerifiedFor(teacherId),
    db
      .select({ approvalStatus: teacherProfilesTable.approvalStatus })
      .from(teacherProfilesTable)
      .where(eq(teacherProfilesTable.userId, teacherId))
      .limit(1),
  ]);
  if (!verified) {
    return { allowed: false, status: 403, code: "EMAIL_UNVERIFIED", message: "Verify your email before buying a teaching plan." };
  }
  if (!profile || profile.approvalStatus !== "approved") {
    return {
      allowed: false,
      status: 403,
      code: "OPERATOR_REVIEW",
      message: profile?.approvalStatus === "rejected"
        ? "Your teacher verification was rejected. Correct the requested documents before choosing a plan."
        : "Your documents must be approved by a Sikshya operator before you can choose a teaching plan.",
    };
  }
  return { allowed: true };
}
