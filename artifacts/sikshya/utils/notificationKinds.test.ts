import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Every kind of notification the server can send has to be something the app does with.
 *
 * The socket carries a `kind`, and the app's handler is an if/else chain that falls through to
 * `return` for anything it does not recognise. So a new kind added on the server arrives, is
 * ignored, and produces nothing at all — no toast, no entry in the notification list, no error
 * anywhere. Both sides compile, both sides' tests pass, and the only way to notice is to make
 * the thing happen and watch for a notification that never comes.
 *
 * That is exactly what happened to `session_rescheduled`: the server sent it, and a student
 * whose class had moved was told nothing.
 *
 * So this reads all three files and checks they agree, rather than trusting that whoever adds
 * the next kind remembers all three.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(path.resolve(here, "..", ...parts), "utf8");

/**
 * The union declared on the server, which is the list everything else must cover.
 *
 * It lives in `notificationEmails.ts` alongside the wording, because that module has to be pure
 * — no database — so the sentences about money can be unit-tested. `notify.ts` re-exports the
 * type for the routes that already import it from there.
 */
function serverKinds(): string[] {
  const source = readFileSync(
    path.resolve(here, "..", "..", "api-server", "src", "lib", "notificationEmails.ts"),
    "utf8",
  );
  const block = source.match(/export type NotificationKind =([\s\S]*?);/);
  assert.ok(block, "NotificationKind is not declared on the server — did it get renamed or moved?");
  const kinds = [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(kinds.length > 0, "no kinds found in the server's NotificationKind");
  return kinds;
}

test("the app's socket type knows every kind the server can send", () => {
  const source = read("hooks", "useUserChannel.ts");
  const block = source.match(/kind:([\s\S]*?);/);
  assert.ok(block, "UserEvent no longer declares a `kind`");
  const known = [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

  for (const kind of serverKinds()) {
    assert.ok(
      known.includes(kind),
      `the server can send "${kind}" and hooks/useUserChannel.ts does not list it`,
    );
  }
});

test("and the app actually does something with each of them", () => {
  /**
   * A substring match on purpose. Anything stricter would have to parse the handler, and the
   * failure being guarded against is not a subtle one — it is a kind that appears nowhere in
   * the file at all.
   */
  const handler = read("context", "NotificationContext.tsx");
  for (const kind of serverKinds()) {
    assert.ok(
      handler.includes(`"${kind}"`),
      `the server can send "${kind}" and context/NotificationContext.tsx never mentions it, ` +
        `so it arrives and is silently dropped`,
    );
  }
});

test("every kind is governed by a preference switch", () => {
  // Otherwise the server throws when it looks one up, and the notification is lost in a catch.
  const source = readFileSync(
    path.resolve(here, "..", "..", "api-server", "src", "lib", "notify.ts"),
    "utf8",
  );
  const table = source.match(/const PREF_KEY: Record<NotificationKind, PrefKind> = \{([\s\S]*?)\n\};/);
  assert.ok(table, "PREF_KEY is not declared — did it get renamed?");
  for (const kind of serverKinds()) {
    assert.ok(
      new RegExp(`^\\s*${kind}:`, "m").test(table[1]),
      `"${kind}" has no row in PREF_KEY`,
    );
  }
});
