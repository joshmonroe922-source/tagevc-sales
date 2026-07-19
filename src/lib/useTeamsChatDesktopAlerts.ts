import { useEffect, useRef } from 'react';
import {
  fetchCalendarStatus,
  fetchTeamsChats,
} from './calendarApi';
import {
  evaluateChatDesktopAlerts,
  getNotificationPermission,
  loadAlertPrefs,
} from './desktopAlerts';
import type { SalesUser } from './types';

/**
 * Portal-wide Teams chat desktop alerts while any portal page is mounted.
 * Seeds on first successful poll after permission is granted (no backlog dump).
 */
export function useTeamsChatDesktopAlerts(
  salesUser: Pick<SalesUser, 'id' | 'email'> | null | undefined,
): void {
  const seededRef = useRef(false);

  useEffect(() => {
    if (!salesUser) return;

    let cancelled = false;
    const prefs = loadAlertPrefs();

    const tick = async () => {
      if (cancelled) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (getNotificationPermission() !== 'granted') return;
      if (document.visibilityState === 'hidden') return;

      try {
        const status = await fetchCalendarStatus();
        if (cancelled) return;
        if (!status.connected || !status.capabilities?.chat) return;

        const res = await fetchTeamsChats({ audit: false });
        if (cancelled) return;

        evaluateChatDesktopAlerts({
          chats: res.chats,
          meId: res.me_id,
          user: salesUser,
          seedOnly: !seededRef.current,
        });
        seededRef.current = true;
      } catch {
        /* silent poll */
      }
    };

    void tick();
    const intervalId = window.setInterval(() => void tick(), prefs.chatPollMs);

    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [salesUser]);
}
