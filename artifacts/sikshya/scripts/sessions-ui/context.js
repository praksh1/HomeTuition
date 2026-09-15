import React from "react";

export function useSafeAreaInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function useDates() {
  return {
    ready: true,
    system: "bs",
    nepaliNumerals: false,
    setSystem: async () => {},
    setNepaliNumerals: async () => {},
    format: (value, options = {}) => {
      const date = new Date(value);
      const day = date.getUTCDate();
      const time = new Intl.DateTimeFormat("en-NP", {
        timeZone: "Asia/Kathmandu",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
      const weekday = options.withWeekday ? "Sunday, " : "";
      return `${weekday}${day} Ashwin 2083 BS${options.withTime ? ` · ${time} Nepal time` : ""}`;
    },
  };
}
