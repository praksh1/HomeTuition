/**
 * Turning a request into a line an audit log can be read from.
 *
 * Pure and dependency-free, and deliberately in its own file rather than beside the middleware
 * that uses it. The whole claim of "every action is recorded" rests on this deriving something
 * sensible from routes nobody has thought about yet, so it has to be testable without an
 * Express request, a database, or a running server.
 */

/** Turns `/api/sessions/42/book` into `session.book`, and picks out the 42. */
export function describeRequest(method: string, path: string): {
  action: string;
  subjectType: string | null;
  subjectId: number | null;
} {
  const parts = path.replace(/^\/api\//, "").replace(/^\/+|\/+$/g, "").split("/");
  const collection = parts[0] ?? "request";
  // "sessions" -> "session", "disputes" -> "dispute". A plural reads oddly as an action.
  const noun = collection.endsWith("s") ? collection.slice(0, -1) : collection;

  const numeric = parts.find((part) => /^\d+$/.test(part));
  const subjectId = numeric ? Number(numeric) : null;

  // The last part that is not an id is what was done: `.../42/book` -> "book". When there is
  // none, the method stands in: a POST to /sessions is a create.
  const verbs = parts.slice(1).filter((part) => !/^\d+$/.test(part));
  const verb = verbs.length > 0
    ? verbs.join(".")
    : method === "POST" ? "create" : method === "DELETE" ? "delete" : "update";

  return { action: `${noun}.${verb}`, subjectType: subjectId === null ? null : noun, subjectId };
}
