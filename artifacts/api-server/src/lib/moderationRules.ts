/** Conservative launch list. Matches create a review case; they do not delete user content. */
const ENGLISH_TERMS = [
  "bitch", "cunt", "fuck", "motherfucker", "nigger", "paki", "retard", "slut", "whore",
];
const NEPALI_TERMS = [
  "चिक्ने", "चिकने", "मुजी", "मूजी", "रन्डी", "रंडी", "मादरचोद", "भालु", "खाते",
];

function terms(): string[] {
  const configured = (process.env.MODERATION_TERMS ?? "").split(",").map((term) => term.trim()).filter(Boolean);
  return [...new Set([...ENGLISH_TERMS, ...NEPALI_TERMS, ...configured].map((term) => term.toLocaleLowerCase()))];
}

export function flaggedTerms(text: string): string[] {
  const folded = text.normalize("NFKC").toLocaleLowerCase();
  return terms().filter((term) => {
    if (/^[a-z]+$/i.test(term)) {
      return new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i").test(folded);
    }
    return folded.includes(term);
  });
}
