export type IdentitySummary = { id: number; status: "pending_upload" | "submitted" | "approved" | "rejected"; holder: "self" | "parent"; rejectionCode: string | null };
export type IdentityStatusResponse = { enabled: boolean; available?: boolean; verification: IdentitySummary | null };
export const rejectionExplanation: Record<string, string> = {
  unreadable: "The document was not clear enough to read. Take a sharper photo in good light.",
  missing_side: "A side of the citizenship card was missing. Include both sides in one PDF or image.",
  details_mismatch: "Some details did not match the document. Check the holder’s name, number, birth date and issuing location.",
  wrong_document: "Upload a citizenship document. A school ID alone does not meet this requirement.",
  consent_required: "Confirm that the document holder has agreed to this submission.",
};
