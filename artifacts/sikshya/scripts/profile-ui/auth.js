const teacher = { id: 1, role: "teacher", name: "Staging Review Teacher", email: "teacher@example.com", subject: "Mathematics", subjects: ["Mathematics", "Science"], bio: "I help SEE students understand difficult ideas through worked examples and patient practice.", approvalStatus: "approved", rating: 4.8, reviewCount: 12 };
const student = { id: 2, role: "student", name: "Staging Review Student", email: "student@example.com", grade: "Class 10", emailVerified: true };
export function useAuth() {
  const isTeacher = new URLSearchParams(window.location.search).get("role") === "teacher" || new URLSearchParams(window.location.search).get("screen") === "teacher";
  return { user: isTeacher ? teacher : student, logout: async () => {}, refreshUser: async () => {} };
}
