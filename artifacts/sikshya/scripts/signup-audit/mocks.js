import { useState } from "react";
export const router = { replace(value) { window.lastNavigation = value; }, back() {}, push(value) { window.lastNavigation = value; } };
export function useLocalSearchParams() { return Object.fromEntries(new URLSearchParams(window.location.search)); }
export function useAuth() {
  const [user, setUser] = useState({ email: "audit@example.com", emailVerified: false, role: "student" });
  return { user, register: async values => { window.registered = values; return { success: true, emailConfigured: false, verificationEmailSent: false }; },
    refreshUser: async () => { if (window.verificationReady) setUser({ ...user, emailVerified: true }); }, logout: async () => { window.signedOut = true; } };
}
export class ApiError extends Error {}
export async function apiPost() { window.resends = (window.resends || 0) + 1; return { sent: true }; }
export function useSafeAreaInsets() { return { top: 0, bottom: 0, left: 0, right: 0 }; }
