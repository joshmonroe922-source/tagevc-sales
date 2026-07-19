import { useEffect } from 'react';
import {
  fetchCalendarEventsDetailed,
  fetchCalendarStatus,
  fetchMasterPortalTodos,
  fetchPlannerTasks,
  loadDisabledCalendarIds,
} from './calendarApi';
import {
  evaluateDesktopAlerts,
  getNotificationPermission,
  loadAlertPrefs,
} from './desktopAlerts';
import { loadStoredPlanId } from './msTaskUtils';
import type { SalesUser } from './types';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * Portal-wide meeting + To Do / Planner desktop alerts while any portal page is mounted.
 */
export function useWorkDesktopAlerts(
  salesUser: Pick<SalesUser, 'id' | 'email' | 'role' | 'portals'> | null | undefined,
): void {
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
        if (cancelled || !status.connected) return;

        const start = startOfDay(new Date());
        const end = addDays(start, 2);

        const [calRes, masterTodo] = await Promise.all([
          fetchCalendarEventsDetailed(start.toISOString(), end.toISOString(), {
            audit: false,
          }).catch(() => ({ events: [], calendars: [] })),
          status.capabilities?.todo
            ? fetchMasterPortalTodos([]).catch(() => null)
            : Promise.resolve(null),
        ]);

        let plannerList: Awaited<ReturnType<typeof fetchPlannerTasks>> = [];
        const planId = loadStoredPlanId();
        if (status.capabilities?.planner && planId) {
          plannerList = await fetchPlannerTasks(planId).catch(() => []);
        }
        if (cancelled) return;

        const disabled = new Set(loadDisabledCalendarIds());
        const evList = (calRes.events ?? []).filter(
          (ev) => !ev.calendar_id || !disabled.has(ev.calendar_id),
        );
        const todoTasks = (masterTodo?.portals ?? []).flatMap((b) => b.tasks);

        evaluateDesktopAlerts({
          events: evList,
          todoTasks,
          plannerTasks: plannerList,
          user: salesUser,
          prefs,
        });
      } catch {
        /* silent poll */
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [salesUser]);
}
