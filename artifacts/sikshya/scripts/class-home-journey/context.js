export function useSafeAreaInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function useDates() {
  return { format: (date) => new Date(date).toLocaleDateString("en-GB", { timeZone: "Asia/Kathmandu", day: "numeric", month: "short", year: "numeric" }) };
}

export function useNotifications() {
  return { lastEvent: null };
}
