/** Booked time is half-open: a class ending at six does not block one starting at six. */
export interface TeachingSlot { startsAt: Date; durationMinutes: number; label: string }

export function overlaps(a: TeachingSlot, b: TeachingSlot): boolean {
  return a.startsAt.getTime() < b.startsAt.getTime() + b.durationMinutes * 60_000 &&
    b.startsAt.getTime() < a.startsAt.getTime() + a.durationMinutes * 60_000;
}

export function slotDescription(slot: TeachingSlot): string {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", dateStyle: "medium", timeStyle: "short" });
  return `${slot.label} (${fmt.format(slot.startsAt)} – ${fmt.format(new Date(slot.startsAt.getTime() + slot.durationMinutes * 60_000))}, Nepal time)`;
}

export function conflictMessages(proposed: TeachingSlot[], occupied: TeachingSlot[], checkInternal = true): string[] {
  const issues: string[] = [];
  for (let i = 0; i < proposed.length; i++) {
    const candidate = proposed[i]!;
    const others = checkInternal ? [...proposed.slice(0, i), ...occupied] : occupied;
    for (const other of others) {
      if (overlaps(candidate, other)) {
        issues.push(`${slotDescription(candidate)} overlaps with ${slotDescription(other)}. Choose another time.`);
        if (issues.length === 10) return issues; // bounded display; every retry checks all slots again
      }
    }
  }
  return issues;
}

export class ScheduleConflictError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) { super(issues[0] ?? "These lessons overlap. Choose another time."); this.issues = issues; }
}
