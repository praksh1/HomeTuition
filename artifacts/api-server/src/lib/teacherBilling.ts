import { PROGRAM_BETA_TEACHER_SHARE_BPS, PROGRAM_BETA_PLATFORM_SHARE_BPS, PROGRAM_BETA_STUDENT_FEE_NPR } from "./programCommerce.ts";
import { batchTestPilotEndsAt } from "./testPilot.ts";

/** Sale controls never grant teaching, membership, or money permissions. */
export function legacyTeacherPlanSalesOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.LEGACY_TEACHER_PLAN_SALES === "paused") return false;
  if (env.LEGACY_TEACHER_PLAN_SALES === "enabled") return true;
  // Existing isolated regression suites exercise the preserved legacy product.
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
