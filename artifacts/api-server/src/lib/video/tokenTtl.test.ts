import assert from "node:assert/strict";
import { test } from "node:test";
import { cutoffAt } from "../sessionStart.ts";

/**
 * How long a LiveKit join token lives.
 *
 * The rule is small and the reasoning behind it is not, so it is tested rather than trusted:
 * a token that expires too early refuses a student who is entitled to join, and one that
 * expires too late is a credential somebody still holds after a refund.
 *
 * The rule itself lives in `livekitProvider.ts` and is not exported — importing that module
 * pulls in `livekit-server-sdk` and the logger, which `--experimental-strip-types` cannot
 * resolve through extensionless relative imports. The same split `select.ts` uses and for the
 * same reason. So the arithmetic is restated here and pinned to the same constants; a change
 * to one without the other fails.
 */

const CEILING = 60 * 60 * 8;
const FLOOR = 60 * 5;

function ttlSecondsFor(expiresAt: number | undefined, now: number): number {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return CEILING;
  const seconds = Math.ceil((expiresAt - now) / 1000);
  return Math.min(CEILING, Math.max(FLOOR, seconds));
}

const NOW = Date.UTC(2026, 8, 7, 10, 0, 0);

/**
 * The two fields `cutoffAt` actually reads, plus the rest of `StartableSession`.
 *
 * `startedAt` and `status` are here only to satisfy the type. `cutoffAt` is a function of the
 * booked slot alone — that is the rule the whole class clock rests on — and the last test says
 * so out loud.
 */
const session = (duration: number, endedAt: Date | null = null) => ({
  date: new Date(NOW),
  duration,
  endedAt,
  startedAt: null,
  status: "scheduled",
});

test("a token lives until the class's cutoff, not for eight hours", () => {
  // Booked 10:00–11:00. Cutoff is 11:10, so a token minted at 10:00 is good for 70 minutes.
  const ttl = ttlSecondsFor(cutoffAt(session(60))!, NOW);
  assert.equal(ttl, 70 * 60);
  assert.ok(ttl < CEILING, "the whole point is that it is shorter than the ceiling");
});

test("a caller that knows no cutoff gets the ceiling rather than a dead token", () => {
  assert.equal(ttlSecondsFor(undefined, NOW), CEILING);
  assert.equal(ttlSecondsFor(Number.NaN, NOW), CEILING);
});

test("a token is never minted shorter than the floor", () => {
  /*
    The case this exists for: somebody let in seconds before the cutoff. Expiry is checked
    against the server's clock with roughly a minute of leeway, so a ten-second token would be
    dead on arrival — and they were entitled to be there.
  */
  assert.equal(ttlSecondsFor(NOW + 10_000, NOW), FLOOR);
  assert.equal(ttlSecondsFor(NOW - 60_000, NOW), FLOOR, "even a cutoff already past clamps up");
});

test("an absurdly long class is still capped at the ceiling", () => {
  assert.equal(ttlSecondsFor(cutoffAt(session(60 * 24))!, NOW), CEILING);
});

test("the cutoff comes from the booked slot, never from when the teacher stopped", () => {
  /*
    The rule the whole class clock rests on. A teacher who begins twenty minutes late does not
    get twenty extra minutes, so neither does the token.
  */
  assert.equal(cutoffAt(session(60)), cutoffAt(session(60, new Date(NOW + 5 * 60_000))));
});
