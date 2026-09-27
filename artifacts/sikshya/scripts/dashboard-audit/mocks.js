import { useEffect } from "react";
export const router = { push(value) { window.lastNavigation = value; }, replace(value) { window.lastNavigation = value; } };
export const useAuth = () => ({ user: { role: "teacher", userId: 1, name: "Synthetic New Teacher", approvalStatus: new URLSearchParams(location.search).get("status") || "pending", subscriptionActive: false }, logout: async () => {} });
export const useNotifications = () => ({ unreadCount: 0, refresh() {} });
export const useDates = () => ({ format: () => "10 Ashwin 2083" });
export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
export const useFocusEffect = callback => useEffect(callback, [callback]);
export class ApiError extends Error {}
export async function apiPatch() { return {}; }
export async function apiGet(url) {
  window.requests = [...(window.requests || []), url];
  if (new URLSearchParams(location.search).has("error")) throw Error("Synthetic offline");
  if (url.includes("agenda=missed")) return { total: 0 };
  return { sessions: [], total: 0 };
}
