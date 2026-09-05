/**
 * Whether the evidence around a class is complete enough for a person to review.
 *
 * This module deliberately does not decide refunds, payouts, teaching quality, or fault. It
 * only answers whether two independent systems observed the teacher in the class and whether
 * those observations agree. A camera being off, silence, or an unused board is not absence.
 *
 * Keep this file dependency-free. The database and provider adapters translate their rows
 * into these small summaries beside their own integrations.
 */

export type EvidenceAvailability = "available" | "partial" | "unavailable";

export interface PresenceEvidence {
  /** Distinguishes a proven zero from a source that could not be read. */
  availability: EvidenceAvailability;
  /** Total observed presence; zero means the source was available and saw no presence. */
  teacherPresentMs: number;
  /** Separate connections observed by this source. */
  teacherJoinCount: number;
}

export interface SupportingEvidence {
  availability: EvidenceAvailability;
  /** A factual count only. Zero must never be converted into a quality verdict. */
  eventCount: number;
}

export interface SessionEvidenceSources {
  /** Sikshya's authenticated classroom WebSocket ledger. */
  classroomSocket: PresenceEvidence;
  /** A provider-authenticated meeting/participant event stream, such as Daily webhooks. */
  mediaProvider: PresenceEvidence;
  /** Coarse client connection-quality buckets; supporting evidence only. */
  networkQuality?: SupportingEvidence;
  boardActivity?: SupportingEvidence;
  chatActivity?: SupportingEvidence;
}

export type EvidenceReviewability =
  | "sufficient_for_human_review"
  | "incomplete"
  | "contradictory";

export type EvidenceGap =
  | "classroom_socket_unavailable"
  | "classroom_socket_partial"
  | "media_provider_unavailable"
  | "media_provider_partial"
  | "network_quality_unavailable"
  | "network_quality_partial";

export type EvidenceContradiction = "teacher_presence_disagrees";

export interface EvidenceCoverage {
  reviewability: EvidenceReviewability;
  gaps: EvidenceGap[];
  contradictions: EvidenceContradiction[];
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function presenceSeen(source: PresenceEvidence): boolean {
  return nonNegative(source.teacherPresentMs) > 0 || nonNegative(source.teacherJoinCount) > 0;
}

/**
 * Classifies evidence coverage without turning evidence into a verdict.
 *
 * Provider and socket presence are deliberately independent: the socket proves the Sikshya
 * classroom was open; a signed provider event proves the media room saw that identity. Client
 * network quality, board activity and chat can add context but cannot make either proof exist.
 */
export function evidenceCoverage(sources: SessionEvidenceSources): EvidenceCoverage {
  const gaps: EvidenceGap[] = [];

  if (sources.classroomSocket.availability === "unavailable") {
    gaps.push("classroom_socket_unavailable");
  } else if (sources.classroomSocket.availability === "partial") {
    gaps.push("classroom_socket_partial");
  }

  if (sources.mediaProvider.availability === "unavailable") {
    gaps.push("media_provider_unavailable");
  } else if (sources.mediaProvider.availability === "partial") {
    gaps.push("media_provider_partial");
  }

  if (sources.networkQuality?.availability === "unavailable") {
    gaps.push("network_quality_unavailable");
  } else if (sources.networkQuality?.availability === "partial") {
    gaps.push("network_quality_partial");
  }

  const contradictions: EvidenceContradiction[] = [];
  if (
    sources.classroomSocket.availability === "available" &&
    sources.mediaProvider.availability === "available" &&
    presenceSeen(sources.classroomSocket) !== presenceSeen(sources.mediaProvider)
  ) {
    contradictions.push("teacher_presence_disagrees");
  }

  return {
    reviewability: contradictions.length > 0
      ? "contradictory"
      : gaps.some((gap) =>
          gap === "classroom_socket_unavailable" ||
          gap === "classroom_socket_partial" ||
          gap === "media_provider_unavailable" ||
          gap === "media_provider_partial")
        ? "incomplete"
        : "sufficient_for_human_review",
    gaps,
    contradictions,
  };
}
