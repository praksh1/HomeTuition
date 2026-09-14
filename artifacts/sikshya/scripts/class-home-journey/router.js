import { useEffect } from "react";

export const router = {
  back: () => {
    window.lastNavigation = "back";
  },
  push: (destination) => {
    window.lastNavigation = destination;
  },
};

export function useLocalSearchParams() {
  return { id: "12" };
}

export function useFocusEffect(callback) {
  useEffect(callback, [callback]);
}
