import { eq } from "drizzle-orm";
import { db, teacherProfilesTable } from "@workspace/db";

import { emailVerifiedFor } from "./accountSecurity";
import { liveTestGrant } from "./testTeachingAccess";

export type TeachingAccess =
  | {
      allowed: true;
      /**
       * Set only when a paid plan was *not* what let this through — an operator's temporary test
       * grant was. Callers that show money or record revenue must branch on it; everything else
       * can ignore it, because a grant changes nothing else about what the teacher may do.
       */
      viaTestGrant?: { grantId: number; tier: string; validUntil: Date };
    }
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
    /*
      The only door a test grant opens, and it opens it here — *after* email verification and
      operator approval have both already passed above.

      Placing it last is the whole safety argument. An unverified or unapproved teacher has already
      returned by this point, so a grant cannot rescue one; and because every class-creation route
      calls this one function, there is no screen-level bypass to keep in step with it.
    */
    const grant = await liveTestGrant(teacherId);
    if (grant) return { allowed: true, viaTestGrant: { grantId: grant.id, tier: grant.tier, validUntil: grant.validUntil } };

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
    return { allowed: false, status: 403, code: "EMAIL_UNVERIFIED", message: "Verify your email before choosing a teaching plan." };
  }
  if (!profile || profile.approvalStatus !== "approved") {
    return {
      allowed: false,
      status: 403,
      code: "OPERATOR_REVIEW",
      // "Your documents must be approved" was wrong about what this gate reads. It reads
      // `approval_status` on the profile, which is the *account* decision; a teacher can have
      // every document accepted and still be waiting. Conflating the two is the same defect the
      // operator emails had, and it sends teachers to re-upload documents that were fine.
      message: profile?.approvalStatus === "rejected"
        ? "Your teacher account was not approved. Check Profile for what to correct before choosing a plan."
        : "A Sikshya operator must approve your teacher account before you can choose a teaching plan.",
    };
  }
  return { allowed: true };
}
