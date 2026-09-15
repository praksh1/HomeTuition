import React from "react";
import { createRoot } from "react-dom/client";

import NotificationsScreen from "../../app/notifications";
import NotificationSettingsScreen from "../../app/notification-settings";

createRoot(document.getElementById("root")!).render(
  location.search.includes("settings") ? <NotificationSettingsScreen /> : <NotificationsScreen />,
);
