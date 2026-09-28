export interface PersonalizedDiscoverCursor {
  rank: number;
  at: Date;
  id: number;
}

/** Rank comes first because a timestamp alone cannot resume a personalized page. */
export function readPersonalizedCursor(raw: string): PersonalizedDiscoverCursor | null {
  const match = /^p(\d+)_(\d+)_(\d+)$/.exec(raw);
  if (!match) return null;
  const rank = Number(match[1]);
  const at = Number(match[2]);
  const id = Number(match[3]);
  if (!Number.isSafeInteger(rank) || rank < 0 || rank > 100 || !Number.isSafeInteger(at) || !Number.isSafeInteger(id) || id < 1) return null;
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? null : { rank, at: when, id };
}

export function personalizedCursorFor(row: PersonalizedDiscoverCursor): string {
  return `p${row.rank}_${row.at.getTime()}_${row.id}`;
}
