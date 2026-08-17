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
  constructor(public status: number, message: string) {
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
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Request failed");
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
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Request failed");
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
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Request failed");
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
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Request failed");
  return data as T;
}
