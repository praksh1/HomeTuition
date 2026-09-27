/** Fail closed: both the access attempt and successful release must be durably audited. */
export async function auditedIdentityRead<T>(kind: "metadata" | "document", audit: (action: string) => Promise<void>, read: () => Promise<T>): Promise<T> {
  await audit(`${kind}_access_requested`);
  const value = await read();
  await audit(`${kind}_opened`);
  return value;
}

/** A request to download is not proof that the operator obtained a readable document. */
export function mayDecideIdentity(input: { ownerId: number; reviewerId: number; status: string; actions: string[] }): boolean {
  return input.ownerId !== input.reviewerId && input.status === "submitted"
    && input.actions.includes("metadata_opened") && input.actions.includes("document_opened");
}
