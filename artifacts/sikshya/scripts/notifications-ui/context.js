import React from "react";

export function useSafeAreaInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function useDates() {
  const [system, setSystem] = React.useState("bs");
  const [nepaliNumerals, setNepaliNumerals] = React.useState(false);
  return {
    ready: true,
    system,
    nepaliNumerals,
    setSystem: async (next) => setSystem(next),
    setNepaliNumerals: async (next) => setNepaliNumerals(next),
    format: (value) => {
      const day = new Date(value).getUTCDate();
      return `${day} Bhadra 2083 BS`;
    },
  };
}

const seed = Array.from({ length: 60 }, (_, index) => ({
  id: `n-${index}`,
  title: index === 0 ? "Anisha sent a class message" : index === 1 ? "Algebra practice is ready" : `Class update ${index + 1}`,
  body: index === 0 ? "Can we review question four in tomorrow's lesson?" : "Open this update to see the confirmed details.",
  type: index % 9 === 0 ? "payment" : index % 7 === 0 ? "live" : "general",
  read: index % 2 === 1,
  createdAt: new Date(Date.now() - index * 3_600_000).toISOString(),
  data: index === 0
    ? { type: "class_message", batchId: 18 }
    : index === 1
      ? { type: "class_homework_set", batchId: 18 }
      : { type: "rescheduled", sessionId: 35 },
}));

export function useNotifications() {
  const [notifications, setNotifications] = React.useState(seed);
  const unreadCount = notifications.filter((item) => !item.read).length;
  React.useEffect(() => {
    window.notificationRows = notifications;
  }, [notifications]);
  return {
    notifications,
    unreadCount,
    refresh: async () => {},
    markOneRead: async (id) => setNotifications((current) => current.map((item) => item.id === id ? { ...item, read: true } : item)),
    markRead: async () => setNotifications((current) => current.map((item) => ({ ...item, read: true }))),
    hasPermission: true,
    emailAvailable: true,
    preferences: {
      push: { messages: true, homework: true, followers: true, programs: true, sessionLive: true, reminders: true, bookings: true },
      email: { messages: true, homework: true, followers: false, programs: false, sessionLive: false, reminders: false, bookings: true },
    },
    setPreference: async () => {},
  };
}
