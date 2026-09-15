/** One canonical route contract for a class conversation. */
export function classConversationId(params: { id?: string | string[]; batchId?: string | string[] }): number | null {
  const raw = params.id ?? params.batchId;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function classConversationDestination(batchId: number | string) {
  return { pathname: "/class-chat" as const, params: { id: String(batchId) } };
}
