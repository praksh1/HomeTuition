/** Age on a UTC date. Date-only input must never shift with the server's timezone. */
export function ageOn(dateOfBirth: string, today = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const born = new Date(Date.UTC(year, month - 1, day));
  if (born.getUTCFullYear() !== year || born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day || born > today) return null;
  let age = today.getUTCFullYear() - year;
  const beforeBirthday = today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

/** Preserve an earlier completion decision while enforcing the photo rule for new teachers. */
export function completedAccountAt(input: {
  existingCompletedAt: Date | null | undefined;
  hasProfilePhoto: boolean;
  role: string;
  now?: Date;
}): Date | null {
  if (input.existingCompletedAt) return input.existingCompletedAt;
  if (input.role === "student" || input.hasProfilePhoto) return input.now ?? new Date();
  return null;
}

/** Accept Nepal mobile and landline formats while rejecting an 11-digit local number. */
export function validNepalPhone(value: string): boolean {
  const compact = value.trim().replace(/[\s()-]/g, "");
  if (!/^\+?\d+$/.test(compact)) return false;
  const local = compact.startsWith("+977")
    ? compact.slice(4)
    : compact.startsWith("977") && compact.length > 10
      ? compact.slice(3)
      : compact;
  return /^(?:9[6-8]\d{8}|0?[1-8]\d{7,8})$/.test(local);
}
