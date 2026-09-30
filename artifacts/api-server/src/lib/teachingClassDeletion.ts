/** A draft can be erased only when no public promise or student record depends on it. */
export function teachingClassDeletionIssue(input: {
  batchStatus: string;
  batchPublishedAt: Date | null;
  batchPublishedSnapshot: unknown;
  hasTestContract: boolean;
  hasTestBooking: boolean;
  isInitialBatch: boolean;
  hasSibling: boolean;
  hasProgramEnrollment: boolean;
  programStatus: string;
  programPublishedAt: Date | null;
  programPublishedSnapshot: unknown;
}): string | null {
  if (input.batchStatus !== "draft" || input.batchPublishedAt || input.batchPublishedSnapshot)
    return "Only an unpublished class with no past offer can be deleted.";
  if (input.hasTestContract || input.hasTestBooking)
    return "A class with a booking or lesson commitment cannot be deleted.";
  if (input.isInitialBatch && (input.hasSibling || input.hasProgramEnrollment || input.programStatus !== "draft" || input.programPublishedAt || input.programPublishedSnapshot))
    return "This class has other dates or a student commitment and cannot be deleted.";
  return null;
}
