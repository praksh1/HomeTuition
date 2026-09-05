/**
 * One session, told by every source that saw it — and honest about which ones did not.
 *
 * ## The distinction this file exists for
 *
 * **"Nothing happened" and "we were not watching" are different facts, and a refund turns on
 * which one it is.** Zero board writes from a teacher is damning. Zero board writes because the
 * board ledger was not recording is nothing at all, and a summary that renders both as `0` will
 * eventually cost somebody a month's fee.
 *
 * So every number here arrives wrapped: `{ available: false }` when the source had nothing to say,
 * `{ available: true, value }` when it did. There is no default of zero anywhere in this file, and
 * the operator view is required to render the two differently.
 *
 * ## It still decides nothing
 *
 * Pure and import-free, like `sessionEvidence.ts`. It produces a timeline and a summary with
 * sources and confidence attached. It emits no verdict, no recommendation and no refund. REFUNDS.md
 * section 3 is explicit that rules over evidence produce a recommendation and *a person decides*;
 * this file stops one step earlier than even that, because the provider corroboration it adds is
 * new, unproven against real traffic, and cannot currently name which account joined.
 */

/* --------------------------------------------------------------------------- availability */

/**
 * A value that might not exist, where absence is meaningful.
 *
 * Deliberately not `number | null`. A nullable number invites `?? 0` at the call site, which is
 * exactly the fabrication being prevented — and this project has already shipped that bug twice,
 * on the teacher dashboard and again one layer down on the subscription screen.
 */
export type Measured<T> =
  | { available: false; because: string }
  | { available: true; value: T };

export const unavailable = <T>(because: string): Measured<T> => ({ available: false, because });
export const measured = <T>(value: T): Measured<T> => ({ available: true, value });

/* -------------------------------------------------------------------------------- sources */

/** How much weight a reader should give a line. Never used to compute anything. */
export type Confidence = "corroborated" | "single-source" | "self-reported" | "absent";

export type EvidenceSource = "socket-ledger" | "provider" | "client-telemetry" | "schedule";

/** The socket ledger's account of one person, as `session_participation` holds it. */
export interface LedgerPresence {
  userId: number;
  name: string;
  role: "teacher" | "student";
  firstJoinedAtMs: number;
  lastSeenAtMs: number;
  presentMs: number;
  joinCount: number;
  drawCount: number;
  messageCount: number;
}

/** A normalized provider event, as stored. */
export interface StoredProviderEvent {
  eventType: "meeting.started" | "meeting.ended" | "participant.joined" | "participant.left";
  eventAtMs: number;
  participantUserId: number | null;
  participantIsOwner: boolean | null;
  durationSeconds: number | null;
}

export type QualityBucket = "good" | "warning" | "bad" | "unknown";

/** A coarse connection sample reported by a client. Corroborating only, never authoritative. */
export interface QualitySample {
  userId: number;
  observedAtMs: number;
  quality: QualityBucket;
  reconnect: boolean;
}

export interface ScheduledWindow {
  scheduledStartMs: number;
  durationMinutes: number;
  startedAtMs: number | null;
  endedAtMs: number | null;
}

/**
 * What each source had to offer, decided by the caller and never inferred here.
 *
 * A caller that cannot reach a table passes `false`, and every figure derived from it comes back
 * unavailable. Inferring "the list was empty so the source was working" is the bug this guards:
 * an empty array is exactly what a failed query and a quiet class both look like.
 */
export interface SourceAvailability {
  ledger: boolean;
  provider: boolean;
  telemetry: boolean;
}

export interface AggregateInput {
  session: ScheduledWindow;
  ledger: LedgerPresence[];
  providerEvents: StoredProviderEvent[];
  quality: QualitySample[];
  available: SourceAvailability;
  /** Everyone who paid, so somebody who never appeared anywhere is still visible. */
  expected: { userId: number; name: string; role: "teacher" | "student" }[];
}

/* ------------------------------------------------------------------------------- timeline */

export interface TimelineEntry {
  atMs: number;
  /** A stable key so the app can style without matching English. */
  code:
    | "scheduled_start"
    | "class_started"
    | "class_ended"
    | "provider_meeting_started"
    | "provider_meeting_ended"
    | "participant_first_seen"
    | "participant_last_seen"
    | "provider_participant_joined"
    | "provider_participant_left"
    | "connection_degraded"
    | "reconnected";
  source: EvidenceSource;
  userId?: number;
  detail: string;
}

/** One person, as each source saw them. */
export interface PersonSummary {
  userId: number;
  name: string;
  role: "teacher" | "student";
  /** Present according to the socket ledger. */
  presentMs: Measured<number>;
  joinCount: Measured<number>;
  drawCount: Measured<number>;
  messageCount: Measured<number>;
  /** Provider's own count of joins for this person, where it could name them. */
  providerJoinCount: Measured<number>;
  /** Reconnections the client itself reported. Self-reported; never authoritative. */
  reportedReconnects: Measured<number>;
  qualityBuckets: Measured<Record<QualityBucket, number>>;
  confidence: Confidence;
}

export interface SessionProofSummary {
  timeline: TimelineEntry[];
  people: PersonSummary[];
  /** Whether the provider independently saw a meeting at all. */
  providerSawMeeting: Measured<boolean>;
  /** Provider's meeting span, when it reported both ends. */
  providerMeetingSpanMs: Measured<number>;
  /** Where each figure could have come from, restated for the reader. */
  sources: SourceAvailability;
  /**
   * Plain sentences about what is missing, so a reader is never left to assume.
   *
   * The most important output in this object. A summary that silently omits a source reads as a
   * complete picture, and this is the line that stops it.
   */
  caveats: string[];
}

const EMPTY_BUCKETS: Record<QualityBucket, number> = { good: 0, warning: 0, bad: 0, unknown: 0 };

/**
 * Everything the sources can say about one class, with nothing filled in.
 *
 * `now` is a parameter so tests pin the clock. Nothing here reads the wall clock.
 */
export function summarizeSessionProof(input: AggregateInput, _now: number = Date.now()): SessionProofSummary {
  const { session, ledger, providerEvents, quality, available, expected } = input;

  const timeline: TimelineEntry[] = [];
  const caveats: string[] = [];

  timeline.push({
    atMs: session.scheduledStartMs,
    code: "scheduled_start",
    source: "schedule",
    detail: `Scheduled to start, for ${session.durationMinutes} minutes.`,
  });
  if (session.startedAtMs !== null) {
    timeline.push({ atMs: session.startedAtMs, code: "class_started", source: "schedule", detail: "The teacher started the class." });
  }
  if (session.endedAtMs !== null) {
    timeline.push({ atMs: session.endedAtMs, code: "class_ended", source: "schedule", detail: "The class ended." });
  }

  /* ------------------------------------------------------------------------ socket ledger */

  if (!available.ledger) {
    caveats.push(
      "The attendance ledger could not be read, so nothing here describes who was connected or " +
        "what they did. This is not the same as nobody attending.",
    );
  } else if (ledger.length === 0) {
    caveats.push("The attendance ledger was readable and holds no rows for this class: nobody's classroom connection was ever recorded as open.");
  }

  if (available.ledger) {
    for (const person of ledger) {
      timeline.push({
        atMs: person.firstJoinedAtMs,
        code: "participant_first_seen",
        source: "socket-ledger",
        userId: person.userId,
        detail: `${person.name} (${person.role}) first connected.`,
      });
      timeline.push({
        atMs: person.lastSeenAtMs,
        code: "participant_last_seen",
        source: "socket-ledger",
        userId: person.userId,
        detail: `${person.name} (${person.role}) was last seen connected.`,
      });
    }
  }

  /* ---------------------------------------------------------------------- provider events */

  let providerSawMeeting: Measured<boolean>;
  let providerMeetingSpanMs: Measured<number>;

  if (!available.provider) {
    const because = "Provider events are not being ingested, or could not be read.";
    providerSawMeeting = unavailable<boolean>(because);
    providerMeetingSpanMs = unavailable<number>(because);
    caveats.push(
      "There is no independent record from the video provider for this class, so the attendance " +
        "figures rest on this app's own socket alone.",
    );
  } else {
    const started = providerEvents.filter((e) => e.eventType === "meeting.started").sort((a, b) => a.eventAtMs - b.eventAtMs)[0] ?? null;
    const ended = providerEvents.filter((e) => e.eventType === "meeting.ended").sort((a, b) => b.eventAtMs - a.eventAtMs)[0] ?? null;

    providerSawMeeting = measured(providerEvents.length > 0);

    if (started) {
      timeline.push({ atMs: started.eventAtMs, code: "provider_meeting_started", source: "provider", detail: "The video provider recorded the meeting starting." });
    }
    if (ended) {
      timeline.push({ atMs: ended.eventAtMs, code: "provider_meeting_ended", source: "provider", detail: "The video provider recorded the meeting ending." });
    }

    providerMeetingSpanMs =
      started && ended && ended.eventAtMs >= started.eventAtMs
        ? measured(ended.eventAtMs - started.eventAtMs)
        : unavailable<number>("The provider did not report both a start and an end for this meeting.");

    for (const event of providerEvents) {
      if (event.eventType === "participant.joined" || event.eventType === "participant.left") {
        const who =
          event.participantUserId !== null
            ? `user ${event.participantUserId}`
            : event.participantIsOwner === true
              ? "an owner (moderator)"
              : event.participantIsOwner === false
                ? "a non-owner participant"
                : "a participant";
        timeline.push({
          atMs: event.eventAtMs,
          code: event.eventType === "participant.joined" ? "provider_participant_joined" : "provider_participant_left",
          source: "provider",
          ...(event.participantUserId !== null ? { userId: event.participantUserId } : {}),
          detail:
            `The video provider recorded ${who} ${event.eventType === "participant.joined" ? "joining" : "leaving"}` +
            (event.durationSeconds !== null ? `, after ${event.durationSeconds}s.` : "."),
        });
      }
    }

    // The limitation that matters most, stated wherever provider events appear.
    if (providerEvents.some((e) => e.participantUserId === null)) {
      caveats.push(
        "The video provider's participant events cannot be tied to a Sikshya account: the meeting " +
          "tokens this app mints carry no user id, so the provider can only distinguish an owner " +
          "from a non-owner. Treat them as evidence that somebody was in the room, not who.",
      );
    }
  }

  /* --------------------------------------------------------------------- client telemetry */

  if (!available.telemetry) {
    caveats.push("No connection-quality reports are available for this class.");
  } else if (quality.length > 0) {
    for (const sample of quality) {
      if (sample.reconnect) {
        timeline.push({ atMs: sample.observedAtMs, code: "reconnected", source: "client-telemetry", userId: sample.userId, detail: "A device reported reconnecting." });
      } else if (sample.quality === "bad" || sample.quality === "warning") {
        timeline.push({
          atMs: sample.observedAtMs,
          code: "connection_degraded",
          source: "client-telemetry",
          userId: sample.userId,
          detail: `A device reported its connection as ${sample.quality}.`,
        });
      }
    }
    caveats.push(
      "Connection-quality reports come from the participants' own devices. They corroborate a bad " +
        "line; they are not proof of one, and a device that never reported is not a device that " +
        "had no trouble.",
    );
  }

  /* --------------------------------------------------------------------------- per person */

  const byId = new Map<number, PersonSummary>();

  const seed = (userId: number, name: string, role: "teacher" | "student"): PersonSummary => {
    const existing = byId.get(userId);
    if (existing) return existing;
    const fresh: PersonSummary = {
      userId,
      name,
      role,
      presentMs: unavailable<number>("The attendance ledger has no row for this person."),
      joinCount: unavailable<number>("The attendance ledger has no row for this person."),
      drawCount: unavailable<number>("The attendance ledger has no row for this person."),
      messageCount: unavailable<number>("The attendance ledger has no row for this person."),
      providerJoinCount: unavailable<number>("The provider could not name this person."),
      reportedReconnects: unavailable<number>("This device reported nothing."),
      qualityBuckets: unavailable<Record<QualityBucket, number>>("This device reported nothing."),
      confidence: "absent",
    };
    byId.set(userId, fresh);
    return fresh;
  };

  for (const person of expected) seed(person.userId, person.name, person.role);

  if (available.ledger) {
    for (const row of ledger) {
      const person = seed(row.userId, row.name, row.role);
      person.name = row.name;
      person.role = row.role;
      person.presentMs = measured(row.presentMs);
      person.joinCount = measured(row.joinCount);
      person.drawCount = measured(row.drawCount);
      person.messageCount = measured(row.messageCount);
    }
  } else {
    for (const person of byId.values()) {
      const because = "The attendance ledger could not be read.";
      person.presentMs = unavailable<number>(because);
      person.joinCount = unavailable<number>(because);
      person.drawCount = unavailable<number>(because);
      person.messageCount = unavailable<number>(because);
    }
  }

  if (available.provider) {
    for (const person of byId.values()) {
      const joins = providerEvents.filter(
        (e) => e.eventType === "participant.joined" && e.participantUserId === person.userId,
      ).length;
      // Zero *named* joins is only meaningful when the provider names anybody at all.
      person.providerJoinCount =
        providerEvents.some((e) => e.participantUserId !== null)
          ? measured(joins)
          : unavailable<number>("The provider's events carry no user id, so they cannot be attributed to this person.");
    }
  }

  if (available.telemetry) {
    for (const person of byId.values()) {
      const mine = quality.filter((q) => q.userId === person.userId);
      if (mine.length === 0) {
        person.reportedReconnects = unavailable<number>("This device reported nothing.");
        person.qualityBuckets = unavailable<Record<QualityBucket, number>>("This device reported nothing.");
        continue;
      }
      const buckets = { ...EMPTY_BUCKETS };
      let reconnects = 0;
      for (const sample of mine) {
        buckets[sample.quality] += 1;
        if (sample.reconnect) reconnects += 1;
      }
      person.reportedReconnects = measured(reconnects);
      person.qualityBuckets = measured(buckets);
    }
  }

  for (const person of byId.values()) {
    const inLedger = person.presentMs.available;
    const namedByProvider = person.providerJoinCount.available && person.providerJoinCount.value > 0;
    person.confidence = inLedger && namedByProvider
      ? "corroborated"
      : inLedger
        ? "single-source"
        : person.reportedReconnects.available
          ? "self-reported"
          : "absent";
  }

  timeline.sort((a, b) => a.atMs - b.atMs);

  return {
    timeline,
    // Teacher first: a refund argument is mostly about the teacher.
    people: [...byId.values()].sort((a, b) => (a.role === b.role ? a.userId - b.userId : a.role === "teacher" ? -1 : 1)),
    providerSawMeeting,
    providerMeetingSpanMs,
    sources: available,
    caveats,
  };
}
