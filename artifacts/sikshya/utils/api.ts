import AsyncStorage from "@react-native-async-storage/async-storage";

export const TOKEN_KEY = "@sikshya_token";

function getApiBase(): string {
  // Explicit API origin, e.g. http://localhost:8080. Needed whenever the app and the API are
  // not served from a single origin — Replit's router merged them, a local dev setup does not,
  // and on iOS/Android a relative "/api" path is not a usable URL at all.
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return `${explicit.replace(/\/+$/, "")}/api`;
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}/api`;
  return "/api";
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  /**
   * The whole response body, not just its message.
   *
   * A refusal often carries what to do about it — "you are already teaching X" comes with the
   * id of X — and throwing that away left the app able to say only that something was wrong.
   * A teacher whose browser had crashed was told they had an active session and given no way
   * back to it.
   */
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${getApiBase()}${path}`, { headers });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Request failed", data);
  return data as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Request failed", data);
  return data as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Request failed", data);
  return data as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "DELETE",
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Request failed", data);
  return data as T;
}

/**
 * A link that opens one attachment, good for a few minutes.
 *
 * The server is asked rather than the bucket directly, for two reasons: it decides whether this
 * person may see the file at all, and the signed link it returns expires — so a URL that ends up
 * in a screenshot or a chat log stops working almost immediately.
 *
 * The redirect is followed manually so the signed target can be handed to the browser or the
 * phone's own viewer. Following it here would download the bytes into the app for nothing.
 */
export async function attachmentUrl(key: string): Promise<string> {
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${getApiBase()}/storage/file?key=${encodeURIComponent(key)}`, {
    headers,
    redirect: "manual",
  });

  // 302 is the happy path: the signed link is in Location.
  const location = res.headers.get("location");
  if (location) return location;

  // Some runtimes follow the redirect regardless; the final URL is then the signed one.
  if (res.ok && res.url && !res.url.includes("/storage/file")) return res.url;

  const data = await res.json().catch(() => ({}) as { error?: string });
  throw new ApiError(res.status, data.error ?? "That file could not be opened.", data);
}
