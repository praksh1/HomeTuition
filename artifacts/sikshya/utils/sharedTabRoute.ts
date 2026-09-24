/** Expo resolves duplicate web paths to one group before account hydration.
 * Keep the intended shared tab when the restored account belongs to the other group.
 * This is navigation only: verification, onboarding and server authorization still apply.
 */
const SHARED_TABS = new Set(["messages", "sessions", "profile"]);

export function sharedTabRoute(role: string, segments: readonly string[]): string | null {
  if (role !== "teacher" && role !== "student") return null;
  const group = `(${role})`;
  if (segments[0] === group || !["(teacher)", "(student)"].includes(segments[0])) return null;
  if (segments.length !== 2 || !SHARED_TABS.has(segments[1])) return null;
  return `/${group}/${segments[1]}`;
}
