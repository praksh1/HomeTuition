import { fromBikramSambat, toBikramSambat, type DateSystem } from "./nepaliDate.ts";

const pad = (value: number) => String(value).padStart(2, "0");
/** DOB is a civil day, never a timestamp. Avoid UTC serialization shifting it by a day. */
function localDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1000) return null;
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day ? date : null;
}
export function birthDateInput(ad: string, system: DateSystem): string {
  const date = localDay(ad);
  if (!date) return "";
  if (system === "ad") return ad;
  const bs = toBikramSambat(date);
  return bs ? `${bs.year}-${pad(bs.month)}-${pad(bs.day)}` : "";
}
export function birthDateToAd(raw: string, system: DateSystem): string | null {
  const value = raw.trim().replace(/[\u0966-\u096f]/g, digit => String(digit.charCodeAt(0) - 0x0966)).replaceAll("/", "-");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  if (system === "ad") return localDay(value) ? value : null;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 32) return null;
  const date = fromBikramSambat(year, month, day, 12);
  const check = date && toBikramSambat(date);
  // The converter normalizes overflowing dates. Citizenship dates must instead be rejected.
  if (!date || !check || check.year !== year || check.month !== month || check.day !== day) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function birthDateLabel(ad: string): string {
  const date = localDay(ad); const bs = date && toBikramSambat(date);
  return bs ? `${bs.day} ${bs.monthName} ${bs.year} BS` : date ? `${ad} AD (BS conversion unavailable)` : "Date unavailable";
}
export function isFutureBirthDate(ad: string, now = new Date()): boolean {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => today.find(item => item.type === type)?.value;
  return ad > `${part("year")}-${part("month")}-${part("day")}`;
}
