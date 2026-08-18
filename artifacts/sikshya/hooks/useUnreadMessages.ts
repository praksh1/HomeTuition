import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { apiGet } from "@/utils/api";

/** How often the badge re-checks while a screen using it is focused. */
const POLL_MS = 20000;

/**
 * Unread message count for the badge on the Messages tab.
 *
 * There was no indicator at all, so a new message was invisible until the user happened to
 * open the tab and look. Polls only while the screen is focused, so a backgrounded app is
 * not calling the API on a timer.
 */
export function useUnreadMessages(): { unread: number; refresh: () => void } {
  const [unread, setUnread] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiGet<{ unread: number }>("/messages/unread-count");
      setUnread(Number.isFinite(res.unread) ? res.unread : 0);
    } catch {
      // Offline or logged out — leave the last known count rather than flashing to zero.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      timer.current = setInterval(refresh, POLL_MS);
      return () => {
        if (timer.current) clearInterval(timer.current);
      };
    }, [refresh]),
  );

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  return { unread, refresh };
}
