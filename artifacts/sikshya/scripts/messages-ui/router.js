import { useEffect, useState } from "react";

export function useFocusEffect(callback) {
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    const update = event => setFocused(event.detail);
    window.addEventListener("message-test-focus", update);
    return () => window.removeEventListener("message-test-focus", update);
  }, []);
  useEffect(() => focused ? callback() : undefined, [focused, callback]);
}

export const router = {
  back: () => { window.lastNavigation = "back"; },
  push: (destination) => { window.lastNavigation = destination; },
  replace: (destination) => { window.lastNavigation = destination; },
};

export function useLocalSearchParams() {
  return { id: "11", name: "Anisha Rai" };
}
