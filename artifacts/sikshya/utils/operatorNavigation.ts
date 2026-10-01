/** UI routing only: the API remains the authority for every operator action. */
export function operatorDestination(role: string | null, mustChangePassword: boolean, first?: string): "/login" | "/password" | "/(admin)" | null {
  if (role !== "admin") return first === "login" ? null : "/login";
  if (mustChangePassword) return first === "password" ? null : "/password";
  return first === undefined || first === "index" || first === "login" || first === "password" ? "/(admin)" : null;
}

/** A service outage is not evidence that the saved credentials were rejected. */
export function operatorAccessRejected(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  return error.status === 401 || error.status === 403;
}
