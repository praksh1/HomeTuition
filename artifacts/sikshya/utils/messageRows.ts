/** Keep unchanged rows and the list identity stable on socket/poll recovery. */
export function stableMessageRows<T extends { id: number }>(previous: T[], incoming: T[]): T[] {
  const oldById = new Map(previous.map(row => [row.id, row]));
  const next = incoming.map(row => {
    const old = oldById.get(row.id);
    return old && JSON.stringify(old) === JSON.stringify(row) ? old : row;
  });
  return previous.length === next.length && next.every((row, index) => row === previous[index]) ? previous : next;
}

/** A latest-page refresh must not silently throw away earlier history already opened. */
export function retainEarlierMessageRows<T extends { id: number }>(previous: T[], incoming: T[]): T[] {
  if (!incoming.length) return previous;
  const first = incoming[0]!.id;
  return stableMessageRows(previous, [...previous.filter(row => row.id < first), ...incoming]);
}
