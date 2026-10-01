export const OWNED_SESSION_PAGE_SIZE = 100;
const MAX_PAGES = 100;
const READ_BUDGET_MS = 30_000;

export interface OwnedSessionPage<T> {
  sessions: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * My classes needs the whole owned timetable, not the newest hundred lesson rows.
 * Never return a partial list: grouping, the nearest lesson and progress need complete data.
 * Offset pagination is not a snapshot; changed totals or missing/duplicated-away rows must
 * fail closed so the screen can retain its last complete read and try again.
 */
export async function readCompleteOwnedSessions<T extends { id: number | string }>(
  readPage: (page: number, limit: number) => Promise<OwnedSessionPage<T>>,
  isCurrent: () => boolean = () => true,
  options: { pageSize?: number; maxPages?: number; budgetMs?: number; now?: () => number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? OWNED_SESSION_PAGE_SIZE;
  const maxPages = options.maxPages ?? MAX_PAGES;
  const budgetMs = options.budgetMs ?? READ_BUDGET_MS;
  const now = options.now ?? Date.now;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES ||
      !Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error("Invalid session read bounds.");
  const started = now();
  const checkCurrent = () => {
    if (!isCurrent()) throw new Error("This session refresh is no longer current.");
    if (now() - started >= budgetMs) throw new Error("The complete class list took too long to load.");
  };
  const sessions = new Map<string, T>();
  let expectedTotal: number | undefined;
  for (let page = 1; page <= maxPages; page++) {
    checkCurrent();
    const response = await readPage(page, pageSize);
    checkCurrent();
    if (!response || !Array.isArray(response.sessions) || !Number.isSafeInteger(response.total) ||
        response.total < 0 || response.page !== page || response.limit !== pageSize ||
        response.sessions.length > pageSize) throw new Error("The class list returned an incomplete page.");
    if (expectedTotal === undefined) expectedTotal = response.total;
    else if (response.total !== expectedTotal) throw new Error("Your class list changed while loading. Please try again.");
    if (expectedTotal > pageSize * maxPages) throw new Error("The class list exceeded this read's safety limit.");
    const previousSize = sessions.size;
    for (const session of response.sessions) {
      const id = session?.id;
      if ((typeof id !== "number" && typeof id !== "string") ||
          (typeof id === "number" && (!Number.isSafeInteger(id) || id <= 0)) ||
          (typeof id === "string" && !id.trim())) throw new Error("A lesson in the class list had no valid ID.");
      // The first occurrence retains server ordering; an offset overlap must not duplicate cards.
      if (!sessions.has(String(id))) sessions.set(String(id), session);
    }
    if (sessions.size === expectedTotal) return [...sessions.values()];
    if (sessions.size > expectedTotal || response.sessions.length < pageSize || sessions.size === previousSize) {
      throw new Error("The complete class list could not be loaded. Please try again.");
    }
  }
  throw new Error("The class list exceeded this read's safety limit.");
}
