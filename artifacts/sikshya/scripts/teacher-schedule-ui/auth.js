import React from "react";
window.__scheduleTeacherId = 81;
export function useAuth() {
  const [id, setId] = React.useState(window.__scheduleTeacherId);
  React.useEffect(() => {
    const update = () => setId(window.__scheduleTeacherId);
    window.addEventListener("schedule-account", update);
    return () => window.removeEventListener("schedule-account", update);
  }, []);
  return { user: { role: "teacher", userId: id } };
}
