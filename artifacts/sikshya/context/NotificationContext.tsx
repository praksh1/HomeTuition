import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";

import {
  getNotifications,
  getUnreadCount,
  markAllRead,
  requestNotificationPermissions,
  seedSampleNotifications,
  type AppNotification,
} from "@/utils/notifications";

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  hasPermission: boolean;
  refresh: () => Promise<void>;
  markRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  hasPermission: false,
  refresh: async () => {},
  markRead: async () => {},
});

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowList: true,
    }),
  });
}

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasPermission, setHasPermission] = useState(false);
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  const refresh = useCallback(async () => {
    const notifs = await getNotifications();
    const count = await getUnreadCount();
    setNotifications(notifs);
    setUnreadCount(count);
  }, []);

  const markRead = useCallback(async () => {
    await markAllRead();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    const init = async () => {
      await seedSampleNotifications();

      const granted = await requestNotificationPermissions();
      setHasPermission(granted);

      await refresh();

      if (Platform.OS !== "web") {
        notificationListener.current = Notifications.addNotificationReceivedListener(async (_notification) => {
          await refresh();
        });

        // Tapping a notification should land on the thing it is about. Previously every tap
        // just refreshed the list and left the user wherever they already were.
        responseListener.current = Notifications.addNotificationResponseReceivedListener(async (response) => {
          await refresh();
          const data = response?.notification?.request?.content?.data as
            | { type?: string; sessionId?: string | number; conversationWith?: string | number }
            | undefined;
          if (!data) return;
          try {
            if (data.sessionId != null && (data.type === "session_reminder" || data.type === "live")) {
              router.push(`/classroom/${data.sessionId}`);
            } else if (data.conversationWith != null || data.type === "message") {
              router.push(data.conversationWith != null ? `/conversation/${data.conversationWith}` : "/notifications");
            } else {
              router.push("/notifications");
            }
          } catch {
            // A route that no longer exists must not take the app down on a tap.
          }
        });
      }
    };

    init();

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [refresh]);

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, hasPermission, refresh, markRead }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => useContext(NotificationContext);
