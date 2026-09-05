/**
 * What a client is allowed to say about its own connection.
 *
 * Client telemetry is the weakest evidence in this product: it is a number a participant's own
 * device chose to send about a dispute that participant may be a party to. It is worth having —
 * "a network related issue from the teacher is an automatic refund" is one of the owner's rules and
 * nothing else in the system can see a bad line — but it must be bounded on the way in and labelled
 * self-reported on the way out.
 *
 * So this file is the sanitiser, and it is deliberately mean. Everything that is not one of four
 * known words is `unknown`; timestamps outside the class are refused; a body with more samples than
 * a class could plausibly produce is truncated rather than trusted; and nothing about audio, video,
 * addresses, device identifiers or raw WebRTC statistics is accepted at all.
 *
 * Pure and import-free, so the bounds can be exercised without a server.
 */

/** The only four words a client may use. Anything else becomes `unknown`. */
export const QUALITY_BUCKETS = ["good", "warning", "bad", "unknown"] as const;
export type QualityBucket = (typeof QUALITY_BUCKETS)[number];

/**
 * The most samples one request may carry.
 *
 * A class is at most three hours and a device is asked to report only on *change*, so a genuine
 * client sends single digits. Sixty is far above that and far below anything that could fill a
 * table.
 */
export const MAX_SAMPLES_PER_REQUEST = 60;

/**
 * The most a device may store for one class, across every request.
 *
 * The bound that actually matters: without it, a client could send sixty samples a second forever.
 * Enforced by the route against a count, not here.
 */
export const MAX_SAMPLES_PER_SESSION_PER_USER = 500;

/** How often one device may post. Enforced by the route; stated here so both agree. */
export const MIN_SECONDS_BETWEEN_REQUESTS = 10;

/**
 * How far outside the class's own window a sample may sit.
 *
 * A device with a wrong clock is common and not evidence of anything, but a sample claiming to be
 * from last week is either broken or hostile, and either way it must not land on a timeline.
 */
export const CLOCK_TOLERANCE_MS = 15 * 60 * 1000;

export interface RawQualitySample {
  quality?: unknown;
  reconnect?: unknown;
  observedAt?: unknown;
}

export interface CleanQualitySample {
  quality: QualityBucket;
  reconnect: boolean;
  observedAtMs: number;
}

export interface SampleWindow {
  /** Earliest instant a sample may claim — normally the scheduled start, less the join window. */
  fromMs: number;
  /** Latest instant a sample may claim — normally the end, or now for a live class. */
  toMs: number;
}

export type SampleRejection = "not_an_object" | "bad_timestamp" | "outside_window";

export interface SanitiseResult {
  accepted: CleanQualitySample[];
  /** Counted, not detailed: a caller does not need to know which of its samples we disliked. */
  rejected: Record<SampleRejection, number>;
  /** True when the request carried more than `MAX_SAMPLES_PER_REQUEST` and was cut. */
  truncated: boolean;
}

function toBucket(value: unknown): QualityBucket {
  return typeof value === "string" && (QUALITY_BUCKETS as readonly string[]).includes(value)
    ? (value as QualityBucket)
    : "unknown";
}

function toMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 100_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 100_000_000_000 ? Math.round(numeric * 1000) : Math.round(numeric);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Clean a batch of client samples against the class's own window.
 *
 * Rejections are counted rather than thrown. A device with a skewed clock should not have its whole
 * report discarded, and a caller that gets a 400 for one bad sample will simply retry the same body
 * forever.
 */
export function sanitiseQualitySamples(raw: unknown, window: SampleWindow): SanitiseResult {
  const rejected: Record<SampleRejection, number> = { not_an_object: 0, bad_timestamp: 0, outside_window: 0 };
  const accepted: CleanQualitySample[] = [];

  const list = Array.isArray(raw) ? raw : [];
  const truncated = list.length > MAX_SAMPLES_PER_REQUEST;
  // Truncate rather than refuse: the first sixty are as useful as any, and a refusal invites a
  // client to retry an oversized body indefinitely.
  const bounded = list.slice(0, MAX_SAMPLES_PER_REQUEST);

  for (const item of bounded) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      rejected.not_an_object += 1;
      continue;
    }
    const sample = item as RawQualitySample;

    const observedAtMs = toMs(sample.observedAt);
    if (observedAtMs === null) {
      rejected.bad_timestamp += 1;
      continue;
    }
    if (observedAtMs < window.fromMs - CLOCK_TOLERANCE_MS || observedAtMs > window.toMs + CLOCK_TOLERANCE_MS) {
      rejected.outside_window += 1;
      continue;
    }

    accepted.push({
      quality: toBucket(sample.quality),
      reconnect: sample.reconnect === true,
      observedAtMs,
    });
  }

  return { accepted, rejected, truncated };
}
