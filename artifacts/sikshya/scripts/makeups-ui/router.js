import { useEffect } from "react";
export const router = {
  back: () => {
    window.lastNavigation = "back";
  },
  push: (value) => {
    window.lastNavigation = value;
  },
  replace: (value) => {
    window.lastNavigation = value;
  },
};
export function useLocalSearchParams() {
  return {
    id: "12",
    ...(new URLSearchParams(location.search).has("original")
      ? { sessionId: "105" }
      : {}),
  };
}
export function useFocusEffect(callback) {
  useEffect(callback, [callback]);
}
