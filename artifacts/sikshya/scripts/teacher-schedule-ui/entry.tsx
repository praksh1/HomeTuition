import React from "react";
import { createRoot } from "react-dom/client";
import TeacherSessions from "../../app/(teacher)/sessions";

const originalSetInterval = window.setInterval;
window.setInterval = ((fn: TimerHandler, delay?: number, ...args: unknown[]) => {
  if (delay === 15_000 && typeof fn === "function") {
    (window as any).__scheduleTick = () => fn(...args);
    return -1;
  }
  return originalSetInterval(fn, delay, ...args);
}) as typeof window.setInterval;
createRoot(document.getElementById("root")!).render(<TeacherSessions />);
