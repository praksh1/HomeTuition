import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_API_TIMEOUT_MS,
  RequestTimeoutError,
  withinRequestDeadline,
} from "./requestDeadline";

export const TOKEN_KEY = "@sikshya_token";

export function apiBase(): string {
  return getApiBase();
}

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

/**
 * What this client is, told to the server on every request.
 *
 * One thing depends on it: which video provider the room route hands back. Daily and LiveKit
 * each ship a fork of the same native WebRTC library and cannot both be inside one phone build,
 * so the phone builds contain Daily. The server reads this and gives a browser whatever
 * `VIDEO_PROVIDER` names while a phone keeps Daily — which is what lets the LiveKit trial be
 * switched on for the web without taking video away from every phone on one deployment.
 *
 * **It grants nothing.** A client that lied about this would be handed the provider it could
 * have been handed honestly. Every right still comes from the server's own membership check.
 */
export const PLATFORM_HEADER = "X-Fadko-Platform";

/**
 * The headers every call sends.
 *
 * One place, because there were five copies of these two lines and a sixth was about to be
 * written. A header added here reaches every request rather than the four somebody remembered.
 */
async function baseHeaders(contentType = "application/json"): Promise<Record<string, string>> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    [PLATFORM_HEADER]: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

interface ApiRequestOptions {
  timeoutMs?: number;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {},
  contentType = "application/json",
): Promise<T> {
  try {
    return await withinRequestDeadline(async (signal) => {
      // Storage is part of the deadline too. A browser whose IndexedDB is wedged must not be
      // able to hold the whole app on its launch screen before the network request even starts.
      const headers = await baseHeaders(contentType);
      const res = await fetch(`${getApiBase()}${path}`, { ...init, headers, signal });
      const data = await readJson(res);
      if (!res.ok) {
        const message = typeof data.error === "string" ? data.error : "Request failed";
        throw new ApiError(res.status, message, data);
      }
      return data as T;
    }, options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof RequestTimeoutError) {
      throw new ApiError(0, "Fadko is taking longer than expected. Please try again.", {
        code: error.code,
        retryable: true,
      });
    }
    if (error instanceof TypeError || (error instanceof Error && error.name === "AbortError")) {
      throw new ApiError(0, "Fadko could not reach the server. Check your connection and try again.", {
        code: "NETWORK_ERROR",
        retryable: true,
      });
    }
    throw error;
  }
}

export async function apiGet<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(path, {}, options);
}

export async function apiPost<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(path, { method: "POST", body: JSON.stringify(body) }, options);
}

export async function apiPatch<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(path, { method: "PATCH", body: JSON.stringify(body) }, options);
}

export async function apiDelete<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(path, { method: "DELETE" }, options);
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
  const { url } = await apiGet<{ url: string }>(`/storage/file?key=${encodeURIComponent(key)}`);
  return url;
}

/**
 * Send raw bytes to our own API — the fallback when a browser will not upload straight to the
 * bucket. Kept here beside the other callers so the auth header and base URL cannot drift.
 */
export async function apiPutBinary<T>(path: string, body: Blob, contentType: string): Promise<T> {
  // A homework PDF on a slow mobile connection needs more room than an ordinary JSON request,
  // but it must still finish or fail instead of waiting forever.
  return apiRequest<T>(path, { method: "PUT", body }, { timeoutMs: 120_000 }, contentType);
}
