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
  /**
   * Whether `eventAtMs` is the provider's clock for the event or for the callback.
   *
   * A span with one end of each kind can be minutes longer than the meeting was, so it is carried
   * here and turned into a caveat rather than quietly averaged away.
   */
  eventAtSource: "occurred" | "delivery";
  /**
   * The provider's id for the meeting *instance* this event belongs to.
   *
   * A room is not a meeting. A call that drops and is rejoined produces a second meeting in the
   * same room, and pairing the first start with the last end measures the gap between them as
   * teaching. Null when the provider did not say.
   */
  providerMeetingId: string | null;
  participantUserId: number | null;
  /** True when the provider named a user who is not in this class and the id was discarded. */
  identityRejected: boolean | null;
  participantIsOwner: boolean | null;
  durationSeconds: number | null;
}

/**
 * One meeting the provider recorded in this class's room, measured on its own.
 *
 * Reported separately and never merged. Two meetings of twenty minutes with an hour between them
 * are not one meeting of an hour and forty, and the difference is the hour nobody was in the room.
 */
export interface ProviderMeetingInstance {
  /** The provider's id, or null for events that carried none — grouped together as one bucket. */
  meetingId: string | null;
  startedAtMs: number | null;
  endedAtMs: number | null;
  /** Available only when this instance reported both of its own ends. */
  spanMs: Measured<number>;
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
  /**
   * Every meeting the provider recorded in this room, each measured on its own.
   *
   * The list, not a total. A reader deciding whether a lesson happened needs to see that the room
   * held one meeting of fifty minutes or three of four, and no single number says both.
   */
  providerMeetings: ProviderMeetingInstance[];
  /**
   * The provider's meeting span — **only when there was exactly one meeting**.
   *
   * Deliberately unavailable rather than summed or spanned when there were several. Summing hides
   * that the class was interrupted; spanning earliest-start to latest-end counts the interruption
   * as teaching. Both are a single number that answers a question nobody asked, and this field
   * used to be the second one.
   */
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
  let providerMeetings: ProviderMeetingInstance[] = [];

  if (!available.provider) {
    const because = "Provider events are not being ingested, or could not be read.";
    providerSawMeeting = unavailable<boolean>(because);
    providerMeetingSpanMs = unavailable<number>(because);
    caveats.push(
      "There is no independent record from the video provider for this class, so the attendance " +
        "figures rest on this app's own socket alone.",
    );
  } else {
    providerSawMeeting = measured(providerEvents.length > 0);

    /*
      Grouped by the provider's own meeting id, never flattened.

      The bug this replaces: the earliest `meeting.started` was paired with the latest
      `meeting.ended` across every meeting in the room. A class where the call dropped at 10:20 and
      was rejoined at 10:40 reported a single fifty-minute meeting, twenty minutes of which nobody
      was in the room — and reported it as the provider's *independent* corroboration, which is the
      figure a refund argument would lean on hardest.
    */
    const byMeeting = new Map<string | null, StoredProviderEvent[]>();
    for (const event of providerEvents) {
      if (event.eventType !== "meeting.started" && event.eventType !== "meeting.ended") continue;
      const key = event.providerMeetingId;
      const bucket = byMeeting.get(key);
      if (bucket) bucket.push(event);
      else byMeeting.set(key, [event]);
    }

    providerMeetings = [...byMeeting.entries()]
      .map(([meetingId, events]) => {
        const starts = events.filter((e) => e.eventType === "meeting.started").map((e) => e.eventAtMs).sort((a, b) => a - b);
        const ends = events.filter((e) => e.eventType === "meeting.ended").map((e) => e.eventAtMs).sort((a, b) => b - a);
        const startedAtMs = starts[0] ?? null;
        const endedAtMs = ends[0] ?? null;
        return {
          meetingId,
          startedAtMs,
          endedAtMs,
          spanMs:
            startedAtMs !== null && endedAtMs !== null && endedAtMs >= startedAtMs
              ? measured(endedAtMs - startedAtMs)
              : unavailable<number>("The provider did not report both ends of this meeting."),
        } satisfies ProviderMeetingInstance;
      })
      .sort((a, b) => (a.startedAtMs ?? Number.MAX_SAFE_INTEGER) - (b.startedAtMs ?? Number.MAX_SAFE_INTEGER));

    for (const meeting of providerMeetings) {
      const which = meeting.meetingId !== null ? ` (meeting ${meeting.meetingId})` : "";
      if (meeting.startedAtMs !== null) {
        timeline.push({
          atMs: meeting.startedAtMs,
          code: "provider_meeting_started",
          source: "provider",
          detail: `The video provider recorded a meeting starting${which}.`,
        });
      }
      if (meeting.endedAtMs !== null) {
        timeline.push({
          atMs: meeting.endedAtMs,
          code: "provider_meeting_ended",
          source: "provider",
          detail: `The video provider recorded a meeting ending${which}.`,
        });
      }
    }

    if (providerMeetings.length > 1) {
      providerMeetingSpanMs = unavailable<number>(
        `The provider recorded ${providerMeetings.length} separate meetings in this room. They are ` +
          "listed individually rather than merged, because the time between them is time nobody " +
          "was in the room.",
      );
      caveats.push(
        `The video provider recorded ${providerMeetings.length} separate meetings for this class. ` +
          "That usually means the call dropped and was rejoined. Each is timed on its own; do not " +
          "add them together and do not treat the first start and last end as one lesson.",
      );
    } else {
      providerMeetingSpanMs =
        providerMeetings[0]?.spanMs ??
        unavailable<number>("The provider did not report a meeting starting or ending for this class.");
    }

    if (providerEvents.some((e) => e.eventAtSource === "delivery")) {
      caveats.push(
        "Some provider timestamps are when the video provider sent us the notification rather " +
          "than when the thing happened. After a retry those can differ by minutes, so treat the " +
          "durations here as approximate.",
      );
    }

    if (providerEvents.some((e) => e.identityRejected === true)) {
      caveats.push(
        "The video provider named at least one participant who is not part of this class, and " +
          "that identification was discarded. It can mean a leftover meeting link was reused; it " +
          "is worth checking before relying on anything else the provider says here.",
      );
    }

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

    /*
      The limitation that matters most, stated wherever provider events appear.

      Only about the *participant* events: a `meeting.started` naturally carries no user id and
      saying so about one would be noise. And it is `participantUserId === null` on a participant
      event that is being described — never inferred from the owner flag, which says what the
      provider believed about somebody's rights and nothing whatever about which account they are.
    */
    const unnamed = providerEvents.filter(
      (e) =>
        (e.eventType === "participant.joined" || e.eventType === "participant.left") &&
        e.participantUserId === null,
    );
    if (unnamed.length > 0) {
      caveats.push(
        "Some of the video provider's participant events cannot be tied to a Sikshya account — " +
          "usually because the class was joined with a meeting token minted before this app " +
          "started identifying participants to the provider. For those, the provider can only " +
          "distinguish an owner from a non-owner. Treat them as evidence that somebody was in the " +
          "room, not who.",
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
    /*
      Zero *named* joins only means something when the provider named somebody.

      If every participant event is anonymous, "the provider recorded 0 joins for this teacher" is
      not a fact about the teacher — it is a fact about the tokens, and rendering it as a zero is
      the fabrication this whole file exists to prevent. Note what is *not* consulted: the owner
      flag. "An owner joined and the teacher is the only owner, so it was the teacher" is a guess,
      and a guess is not corroboration.
    */
    const namesAnybody = providerEvents.some(
      (e) =>
        (e.eventType === "participant.joined" || e.eventType === "participant.left") &&
        e.participantUserId !== null,
    );
    for (const person of byId.values()) {
      const joins = providerEvents.filter(
        (e) => e.eventType === "participant.joined" && e.participantUserId === person.userId,
      ).length;
      person.providerJoinCount = namesAnybody
        ? measured(joins)
        : unavailable<number>("The provider's events carry no user id, so they cannot be attributed to this person.");
    }

    /*
      A contradiction worth a sentence: the provider said somebody had moderator rights, and that
      account is not this class's teacher.

      Rights are this server's decision and the provider's flag is only ever a record of what it
      believed — but a disagreement here means a token was minted for the wrong person or reused
      from another class, and either is more interesting than any duration on the page.
    */
    const ownerIds = new Set(
      providerEvents
        .filter((e) => e.participantIsOwner === true && e.participantUserId !== null)
        .map((e) => e.participantUserId as number),
    );
    const teacherIds = new Set([...byId.values()].filter((p) => p.role === "teacher").map((p) => p.userId));
    const strangers = [...ownerIds].filter((id) => !teacherIds.has(id));
    if (strangers.length > 0) {
      caveats.push(
        "The video provider recorded somebody with moderator rights who is not this class's " +
          "teacher. Rights in this app are decided by its own membership check and never by the " +
          "provider, so nobody gained anything — but it is worth finding out why.",
      );
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
    providerMeetings,
    providerMeetingSpanMs,
    sources: available,
    caveats,
  };
}
