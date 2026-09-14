export const router = {
  back: () => { window.lastNavigation = "back"; },
  push: (destination) => { window.lastNavigation = destination; },
  replace: (destination) => { window.lastNavigation = destination; },
};

export function useLocalSearchParams() {
  return { id: "11", name: "Anisha Rai" };
}
