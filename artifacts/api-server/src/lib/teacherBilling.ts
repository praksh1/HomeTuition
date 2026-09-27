import { PROGRAM_BETA_TEACHER_SHARE_BPS, PROGRAM_BETA_PLATFORM_SHARE_BPS, PROGRAM_BETA_STUDENT_FEE_NPR } from "./programCommerce.ts";
import { batchTestPilotEndsAt } from "./testPilot.ts";

/** Sale controls never grant teaching, membership, or money permissions. */
export function legacyTeacherPlanSalesOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  // Historical contracts remain readable, but no deployed environment may sell another
  // teacher plan. An old Railway variable must not silently reopen the obsolete checkout.
  return env.NODE_ENV === "test" && env.LEGACY_TEACHER_PLAN_SALES !== "paused";
}

/** The old POST /sessions exists only to replay historical contracts in isolated tests. */
export function legacyStandaloneCreationOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "test";
}

export function teacherBillingPolicy(env: NodeJS.ProcessEnv = process.env) {
  return {
    legacyPlanSalesOpen: legacyTeacherPlanSalesOpen(env),
    newClassCheckoutOpen: false,
    testPilotEndsAt: batchTestPilotEndsAt(env),
    teacherShareBps: PROGRAM_BETA_TEACHER_SHARE_BPS,
    platformShareBps: PROGRAM_BETA_PLATFORM_SHARE_BPS,
    studentFeeNpr: PROGRAM_BETA_STUDENT_FEE_NPR,
    status: "preparing" as const,
  };
}

export const LEGACY_PLAN_PAUSED = {
  code: "LEGACY_PLAN_SALES_PAUSED",
  error: "New teacher plan purchases are paused. Existing classes keep their current access. You can prepare a new class without buying a tier.",
};
