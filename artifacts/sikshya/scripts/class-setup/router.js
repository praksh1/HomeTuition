import { useSyncExternalStore } from "react";
let id;
const listeners = new Set();
export const router = {
  replace: (url) => { window.lastNavigation = url; id = url?.params?.id; for (const fn of listeners) fn(); },
  push: (url) => { window.lastNavigation = url; },
};
export function useLocalSearchParams() { return { id: useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => id) }; }
export function useNavigation() { return { dispatch: () => {} }; }
export function usePreventRemove() {} // Native Back remains a real-device test.
export function useAuth() { return { user: { id: 1 } }; }
export const randomUUID = () => crypto.randomUUID();
