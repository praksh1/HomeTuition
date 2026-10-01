/** One format for count-bearing tabs and filters. Unknown counts are not invented. */
export function filterCountLabel(label: string, count: number | null | undefined): string {
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0
    ? `${label} (${count})`
    : label;
}
