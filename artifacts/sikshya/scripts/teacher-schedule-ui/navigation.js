import React from "react";
window.__scheduleFocused = true;
export function useFocusEffect(effect) {
  const [focused, setFocused] = React.useState(true);
  React.useEffect(() => {
    const update = () => setFocused(window.__scheduleFocused);
    window.addEventListener("schedule-focus", update);
    return () => window.removeEventListener("schedule-focus", update);
  }, []);
  React.useEffect(() => focused ? effect() : undefined, [effect, focused]);
}
