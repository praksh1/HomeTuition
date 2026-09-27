/** Mirrors the server's UTC date-only age rule; parity is covered by tests. */
export function registrationAge(value: string, today = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const born = new Date(Date.UTC(year, month - 1, day));
  if (born.getUTCFullYear() !== year || born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day || born > today) return null;
  return today.getUTCFullYear() - year - Number(today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day));
}
export const SUBJECT_SUGGESTIONS = ["Mathematics", "Science", "English", "Nepali", "Korean", "IELTS preparation", "SEE preparation", "A-Level preparation", "Lok Sewa preparation", "Medical entrance preparation", "Computer Science", "Social Studies", "History", "Geography", "Economics", "Accountancy", "Music", "Art"];
export const LEARNER_LEVELS = ["Primary school", "Middle school", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12", "College / university", "Adult / professional", "Exam preparation", "Other / not applicable"];
export type RegistrationValues = { name: string; email: string; password: string; confirmPassword: string; subject: string; bio: string; grade: string; dateOfBirth: string; guardianName: string; guardianEmail: string; guardianPhone: string; guardianRelationship: string };
export type RegistrationErrors = Partial<Record<keyof RegistrationValues, string>>;
export function registrationErrors(v: RegistrationValues, teacher: boolean, today = new Date()): RegistrationErrors {
  const e: RegistrationErrors = {};
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const required = (key: keyof RegistrationValues, message: string) => { if (!v[key].trim()) e[key] = message; };
  required("name", "Enter your full name.");
  if (!email.test(v.email.trim())) e.email = "Enter a valid email address you can open.";
  if (v.password.length < 8) e.password = "Use at least 8 characters.";
  if (!v.confirmPassword || v.password !== v.confirmPassword) e.confirmPassword = "Enter the same password again.";
  if (teacher) {
    required("subject", "Choose or type the subject you teach.");
    required("bio", "Tell students about your experience and teaching style.");
  } else {
    const age = registrationAge(v.dateOfBirth, today);
    if (age === null) e.dateOfBirth = "Enter a valid birth date in your selected calendar, not in the future.";
    required("grade", "Choose your current learning level.");
    if (age !== null && age < 18) {
      required("guardianName", "Enter your parent or guardian’s name.");
      if (!email.test(v.guardianEmail.trim())) e.guardianEmail = "Enter a valid parent or guardian email.";
      required("guardianPhone", "Enter your parent or guardian’s phone number.");
      required("guardianRelationship", "Tell us their relationship to you.");
    }
  }
  return e;
}
