import { execFileSync } from "node:child_process";

/** Allocate setup slots for independent tests, never for a product scheduling decision.
 * Call sequentially; tests of concurrent *moves/bookings* start after fixture creation.
 */
export function fixtureStart(teacherId, target, duration, excludingId = 0, connection = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht") {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Fixture scheduling requires a local disposable database");
  if (![teacherId, duration, excludingId].every(Number.isSafeInteger) || teacherId <= 0 || duration <= 0 || excludingId < 0 || !Number.isFinite(target)) throw new Error("Invalid schedule fixture inputs");
  const raw = execFileSync("psql", [connection, "-v", "ON_ERROR_STOP=1", "-tAc",
    `select coalesce(json_agg(json_build_object('start', extract(epoch from date)*1000, 'duration', duration)), '[]') from sessions where teacher_id=${teacherId} and id<>${excludingId} and status in ('upcoming','live')`], { encoding: "utf8" });
  const slots = JSON.parse(raw);
  let at = target;
  for (;;) {
    const hit = slots.find((slot) => at < Number(slot.start) + slot.duration * 60000 && at + duration * 60000 > Number(slot.start));
    if (!hit) return at;
    at = Number(hit.start) + hit.duration * 60000 + 60000;
  }
}
