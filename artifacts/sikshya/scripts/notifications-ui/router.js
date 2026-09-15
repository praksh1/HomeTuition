export const router = {
  back: () => { window.lastNavigation = "back"; },
  push: (destination) => { window.lastNavigation = destination; },
};
