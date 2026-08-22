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

import { useAuth } from "@/context/AuthContext";
import { useUserChannel, type UserEvent } from "@/hooks/useUserChannel";
import { apiGet, apiPatch } from "@/utils/api";
import {
  getNotifications,
  getUnreadCount,
  markAllRead,
  notifyNewFollower,
  notifyNewMessage,
  notifySessionInvite,
  notifySessionLive,
  notifySessionMessage,
  requestNotificationPermissions,
  type AppNotification,
} from "@/utils/notifications";
import {
  DEFAULT_PREFS,
  type NotificationPrefs,
  type PrefChannel,
  type PrefKind,
} from "@/utils/notificationPrefs";

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  hasPermission: boolean;
  /** What this user has asked to be told about. Defaults until the server answers. */
  preferences: NotificationPrefs;
  /** False when the server has no mail provider configured, so email switches cannot work. */
  emailAvailable: boolean;
  /**
   * The last event that arrived on the socket, whatever kind it was.
   *
   * Exposed so a screen can react to something happening *while it is open* without polling —
   * the class message thread listens for `session_message` and asks for what it has not seen.
   * Deliberately the raw event: it is a nudge, not the data. A screen that trusted the event's
   * contents would show a message the server has not confirmed.
   */
  lastEvent: UserEvent | null;
  refresh: () => Promise<void>;
  markRead: () => Promise<void>;
  setPreference: (channel: PrefChannel, kind: PrefKind, value: boolean) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  lastEvent: null,
  hasPermission: false,
  preferences: DEFAULT_PREFS,
  emailAvailable: false,
  refresh: async () => {},
  markRead: async () => {},
  setPreference: async () => {},
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

/** Opens the screen a notification is about. Shared by taps and by in-app events. */
function openTarget(data: {
  type?: string;
  sessionId?: string | number;
  conversationWith?: string | number;
}): void {
  try {
    if (data.sessionId != null && data.type === "session_message") {
      // The class's own page, where the thread is and where the Join button is — not the
      // classroom, which would put a waiting student into a call to read a message.
      router.push(`/session/${data.sessionId}`);
    } else if (data.sessionId != null && (data.type === "session_reminder" || data.type === "live")) {
      router.push(`/classroom/${data.sessionId}`);
    } else if (data.conversationWith != null || data.type === "message") {
      router.push(data.conversationWith != null ? `/conversation/${data.conversationWith}` : "/notifications");
    } else {
      router.push("/notifications");
    }
  } catch {
    // A route that no longer exists must not take the app down on a tap.
  }
}

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasPermission, setHasPermission] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [emailAvailable, setEmailAvailable] = useState(false);
  const [lastEvent, setLastEvent] = useState<UserEvent | null>(null);
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  /**
   * Events already turned into a notification, keyed by sender and timestamp.
   *
   * A user with the app open on a phone and a laptop, or one whose socket reconnects mid-send,
   * can be handed the same event twice. Without this they see the same message announced
   * twice, which reads as the app being broken.
   */
  const seen = useRef<Set<string>>(new Set());

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

  /** Turns one server event into a notification the user can see and act on. */
  const onEvent = useCallback(
    async (event: UserEvent) => {
      // Published before the de-duplication below, because a screen listening for its own
      // updates wants every nudge — two copies cost it one extra request, a missed one costs
      // it a message that never appears.
      setLastEvent(event);

      const key = `${event.kind}:${event.fromUserId ?? event.sessionId ?? ""}:${event.at ?? ""}`;
      if (seen.current.has(key)) return;
      seen.current.add(key);
      // Bounded so a long session cannot grow this without limit.
      if (seen.current.size > 300) seen.current = new Set([...seen.current].slice(-150));

      try {
        if (event.kind === "message" && event.fromUserId != null) {
          await notifyNewMessage({
            senderName: event.fromName ?? "Someone",
            body: event.preview ?? "",
            senderId: event.fromUserId,
          });
        } else if (event.kind === "follower") {
          await notifyNewFollower({ name: event.fromName ?? "A student", userId: event.fromUserId ?? 0 });
        } else if (event.kind === "session_invite") {
          await notifySessionInvite({
            topic: event.topic ?? "a class",
            teacherName: event.fromName,
            sessionId: event.sessionId,
          });
        } else if (event.kind === "session_message") {
          // A class's own thread, which is where a teacher says they are running late. It
          // deserves a notification for the same reason a direct message does: it is somebody
          // talking to you, and it is time-critical far more often than not.
          await notifySessionMessage({
            senderName: event.fromName ?? "Someone",
            body: event.preview ?? "",
            sessionId: event.sessionId ?? 0,
            topic: event.topic,
          });
        } else if (event.kind === "session_live") {
          await notifySessionLive({
            topic: event.topic ?? "Your class",
            teacherName: event.fromName,
            sessionId: event.sessionId,
          });
        } else {
          return;
        }
      } catch {
        // Storage full or notifications unavailable — not worth taking the channel down.
      }
      await refresh();
    },
    [refresh],
  );

  // One socket for as long as someone is signed in. The classroom socket only carries one
  // lesson, so anything happening outside a lesson had no way to reach the app at all.
  useUserChannel(Boolean(user), (event) => {
    void onEvent(event);
  });

  const loadPreferences = useCallback(async () => {
    try {
      const res = await apiGet<{ preferences: NotificationPrefs; emailAvailable: boolean }>(
        "/notification-preferences",
      );
      if (res?.preferences) setPreferences(res.preferences);
      setEmailAvailable(Boolean(res?.emailAvailable));
    } catch {
      // Offline or an older server — the defaults already in state are the right fallback.
    }
  }, []);

  const setPreference = useCallback(
    async (channel: PrefChannel, kind: PrefKind, value: boolean) => {
      // Applied locally first so the switch moves under the user's finger; rolled back if the
      // server refuses, rather than leaving a switch that lies about what will happen.
      const previous = preferences;
      const next: NotificationPrefs = {
        push: { ...preferences.push },
        email: { ...preferences.email },
      };
      next[channel][kind] = value;
      setPreferences(next);
      try {
        const res = await apiPatch<{ preferences: NotificationPrefs; emailAvailable: boolean }>(
          "/notification-preferences",
          { [channel]: { [kind]: value } },
        );
        if (res?.preferences) setPreferences(res.preferences);
      } catch {
        setPreferences(previous);
        throw new Error("Could not save that. Check your connection and try again.");
      }
    },
    [preferences],
  );

  useEffect(() => {
    if (!user) {
      setPreferences(DEFAULT_PREFS);
      return;
    }
    void loadPreferences();
  }, [user, loadPreferences]);

  useEffect(() => {
    const init = async () => {
      const granted = await requestNotificationPermissions();
      setHasPermission(granted);

      await refresh();

      if (Platform.OS !== "web") {
        notificationListener.current = Notifications.addNotificationReceivedListener(async () => {
          await refresh();
        });

        // Tapping a notification should land on the thing it is about. Previously every tap
        // just refreshed the list and left the user wherever they already were.
        responseListener.current = Notifications.addNotificationResponseReceivedListener(async (response) => {
          await refresh();
          const data = response?.notification?.request?.content?.data as
            | { type?: string; sessionId?: string | number; conversationWith?: string | number }
            | undefined;
          if (data) openTarget(data);
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
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        hasPermission,
        preferences,
        emailAvailable,
        lastEvent,
        refresh,
        markRead,
        setPreference,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => useContext(NotificationContext);
