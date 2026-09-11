export const router = { replace: (url) => { window.lastNavigation = url; } };
export function useLocalSearchParams() { return { id: "1" }; }
export function useNavigation() { return { dispatch: () => {} }; }
export function usePreventRemove() {} // Native navigation is outside this browser harness.
