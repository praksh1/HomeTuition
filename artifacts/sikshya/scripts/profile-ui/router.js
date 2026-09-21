export const router = { push(value) { window.lastNavigation = value; }, replace(value) { window.lastNavigation = value; } };
export function useLocalSearchParams() { return { edit: "1" }; }
export function usePathname() { return "/profile"; }
