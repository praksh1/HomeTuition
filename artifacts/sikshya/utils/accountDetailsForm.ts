export type AffiliationStatus = "affiliated" | "independent" | "not_specified" | "unselected";

export type AccountDetailsDraft = {
  phone: string;
  province: string;
  district: string;
  localLevel: string;
  locality: string;
  institutionName: string;
  affiliationStatus: AffiliationStatus;
};

export type AccountDetailsField =
  | "phone"
  | "province"
  | "district"
  | "localLevel"
  | "affiliationStatus"
  | "institutionName";

export type AccountDetailsIssue = { field: AccountDetailsField; message: string };

type SavedDetails = Partial<Record<keyof AccountDetailsDraft, string | null>>;

const phonePattern = /^\+?[0-9][0-9 -]{6,17}$/;
const affiliations = new Set<AffiliationStatus>(["affiliated", "independent", "not_specified"]);

export const EMPTY_ACCOUNT_DETAILS: AccountDetailsDraft = {
  phone: "",
  province: "",
  district: "",
  localLevel: "",
  locality: "",
  institutionName: "",
  affiliationStatus: "unselected",
};

/**
 * Only a coherent saved form is allowed to prefill the editor.
 *
 * Older fixtures and migrations sometimes contain a plausible Nepal location but no phone or
 * affiliation. There is no evidence that the person chose those values. Showing them as selected
 * turns a database placeholder into a claim about a real person, so an incomplete row is presented
 * as incomplete and the person chooses their own details.
 */
export function accountDetailsDraft(saved: SavedDetails | null | undefined): AccountDetailsDraft {
  if (!saved) return { ...EMPTY_ACCOUNT_DETAILS };
  const affiliation = affiliations.has(saved.affiliationStatus as AffiliationStatus)
    ? saved.affiliationStatus as AffiliationStatus
    : "unselected";
  const coherent = Boolean(
    saved.phone?.trim()
      && phonePattern.test(saved.phone.trim())
      && saved.province?.trim()
      && saved.district?.trim()
      && saved.localLevel?.trim()
      && affiliation !== "unselected"
      && (affiliation === "independent" || saved.institutionName?.trim()),
  );
  if (!coherent) return { ...EMPTY_ACCOUNT_DETAILS };
  return {
    phone: saved.phone!.trim(),
    province: saved.province!.trim(),
    district: saved.district!.trim(),
    localLevel: saved.localLevel!.trim(),
    locality: saved.locality?.trim() ?? "",
    institutionName: saved.institutionName?.trim() ?? "",
    affiliationStatus: affiliation,
  };
}

/** One specific next action is calmer and more useful than a generic list of every required field. */
export function firstAccountDetailsIssue(draft: AccountDetailsDraft): AccountDetailsIssue | null {
  const phone = draft.phone.trim();
  if (!phone) return { field: "phone", message: "Enter your phone number." };
  if (!phonePattern.test(phone)) return { field: "phone", message: "Enter a valid phone number, including the area or mobile code." };
  if (!draft.province.trim()) return { field: "province", message: "Choose your province." };
  if (!draft.district.trim()) return { field: "district", message: "Choose your district." };
  if (!draft.localLevel.trim()) return { field: "localLevel", message: "Choose or enter your municipality or local level." };
  if (draft.affiliationStatus === "unselected") {
    return { field: "affiliationStatus", message: "Choose your school affiliation." };
  }
  if (draft.affiliationStatus !== "independent" && !draft.institutionName.trim()) {
    return { field: "institutionName", message: "Choose or enter your school or college." };
  }
  return null;
}

export function completeAccountDetails(saved: SavedDetails | null | undefined): boolean {
  return accountDetailsDraft(saved).affiliationStatus !== "unselected";
}
