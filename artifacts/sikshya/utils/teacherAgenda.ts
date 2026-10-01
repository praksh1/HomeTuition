/** Dashboard and Sessions read the same clock-filtered, server-ordered agenda. */
export function teacherAgendaPath(teacherId: number, mode: "upcoming" | "missed", limit: number) {
  return `/sessions?teacherId=${teacherId}&status=upcoming&agenda=${mode}&limit=${limit}`;
}

/** Calendar days, not elapsed 24h blocks; all class labels use the same Nepal clock. */
export function teacherAgendaTimeLabel(
  value: string,
  formatDate: (date: Date, options: { withTime: boolean }) => string,
  now = new Date(),
): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  const nepalDay = (d: Date) => Math.floor((d.getTime() + 345 * 60_000) / 86_400_000);
  const days = nepalDay(date) - nepalDay(now);
  const day = days === 0 ? "Today" : days === 1 ? "Tomorrow" : formatDate(date, { withTime: false });
  const time = date.toLocaleTimeString("en-GB", { timeZone: "Asia/Kathmandu", hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time} Nepal time`;
}
