export function useAuth() {
  const role = new URLSearchParams(location.search).get("role");
  return role === "teacher"
    ? { user: { role: "teacher", userId: 81 } }
    : { user: { role: "student", userId: 91 } };
}
