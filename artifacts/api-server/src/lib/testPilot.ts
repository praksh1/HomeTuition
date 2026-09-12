/** A fixed deployment setting, never a rolling "120 days from this request" deadline. */
export function testPilotDeadline(env: Record<string, string | undefined> = process.env, now = Date.now()): number | null {
  const value = env.TEST_ACCESS_UNTIL;
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const until = Date.parse(value);
  const canonical = value.includes(".") ? value : value.replace("Z", ".000Z");
  return Number.isFinite(until) && new Date(until).toISOString() === canonical && until > now && until - now <= 124 * 86400_000 ? until : null;
}

export function batchTestPilotEndsAt(env: Record<string, string | undefined> = process.env, now = Date.now()): string | null {
  const enabled = (value: string | undefined) => ["true", "1"].includes((value ?? "").trim().toLowerCase());
  const until = testPilotDeadline(env, now);
  return until && enabled(env.ALLOW_TEST_TEACHING_ACCESS) && enabled(env.ALLOW_TEST_STUDENT_ACCESS) ? new Date(until).toISOString() : null;
}

/** Existing test installations without a pilot date retain their two explicit kill switches. */
export function testPilotAllowsExistingAccess(env: Record<string, string | undefined> = process.env, now = Date.now()): boolean {
  return env.TEST_ACCESS_UNTIL === undefined || testPilotDeadline(env, now) !== null;
}
