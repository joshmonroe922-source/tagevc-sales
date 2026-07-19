import { useEffect, useRef } from 'react';
import {
  fetchCalendarStatus,
  fetchMailMessages,
} from './calendarApi';
import {
  evaluateMailDesktopAlerts,
  getNotificationPermission,
  loadAlertPrefs,
} from './desktopAlerts';
import type { SalesUser } from './types';

/**
 * Portal-wide Outlook mail desktop alerts while any portal page is mounted.
 * Seeds on first successful poll after permission is granted (no backlog dump).
 */
export function useMailDesktopAlerts(
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
        if (!status.connected || !status.capabilities?.mail) return;

        const res = await fetchMailMessages({
          well_known: 'inbox',
          top: 15,
          audit: false,
        });
        if (cancelled) return;

        evaluateMailDesktopAlerts({
          messages: res.messages,
          myEmail: status.microsoft_email ?? status.preferred_work_email,
          user: salesUser,
          seedOnly: !seededRef.current,
        });
        seededRef.current = true;
      } catch {
        /* silent poll */
      }
    };

    void tick();
    const intervalId = window.setInterval(() => void tick(), prefs.mailPollMs);

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
