'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import {
  getMyAvailabilityAction,
  listMySoftAlertsAction,
  markSoftAlertReadAction,
  setMyAvailabilityAction,
  syncCalendarPresenceAction,
} from '@/app/(app)/messages/presence-actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type AlertRow = {
  id: string;
  conversation_id: string;
  kind: string;
  title: string;
  body: string | null;
  priority: string;
  deferred: boolean;
  created_at: string;
};

/**
 * Global non-spammy message alert host + availability control.
 * Mount once in the app shell.
 */
export function MessagePresenceHost() {
  const [status, setStatus] = useState<'available' | 'dnd'>('available');
  const [source, setSource] = useState<'manual' | 'calendar'>('manual');
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState<AlertRow | null>(null);

  function refresh() {
    startTransition(async () => {
      const [avail, soft] = await Promise.all([
        getMyAvailabilityAction(),
        listMySoftAlertsAction(),
      ]);
      if (avail.ok) {
        setStatus(avail.status);
        setSource(avail.source);
      }
      if (soft.ok) {
        setAlerts(soft.alerts);
        const next = soft.alerts.find((a) => !a.deferred) ?? null;
        setBanner(next);
      }
    });
  }

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 25_000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  function toggleAvailability() {
    const next = status === 'available' ? 'dnd' : 'available';
    startTransition(async () => {
      const res = await setMyAvailabilityAction(next);
      if (res.ok) {
        setStatus(res.status);
        setSource(res.source);
        if (next === 'available') refresh();
      }
    });
  }

  function syncCalendar() {
    startTransition(async () => {
      await syncCalendarPresenceAction();
      refresh();
    });
  }

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-card/95 p-2 shadow-lg backdrop-blur">
        <button
          type="button"
          disabled={pending}
          onClick={toggleAvailability}
          className={cn(
            'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
            status === 'available'
              ? 'bg-emerald-50 text-emerald-900'
              : 'bg-red-50 text-red-900',
          )}
          title="Toggle Available / Do Not Disturb"
        >
          <span
            className={cn(
              'inline-block size-2.5 rounded-full',
              status === 'available' ? 'bg-emerald-500' : 'bg-red-500',
            )}
          />
          <span className="font-medium">
            {status === 'available' ? 'Available' : 'Do Not Disturb'}
          </span>
          <span className="text-xs opacity-70">
            {source === 'calendar' ? '· calendar' : ''}
          </span>
        </button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={syncCalendar}
          className="shrink-0 text-xs"
        >
          Sync cal
        </Button>
      </div>

      {banner ? (
        <div
          className={cn(
            'pointer-events-auto rounded-lg border bg-card p-3 shadow-lg',
            banner.priority === 'urgent' || banner.kind === 'urgent_dnd'
              ? 'border-amber-400'
              : 'border-border',
          )}
        >
          <p className="text-sm font-medium text-foreground">{banner.title}</p>
          {banner.body ? (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {banner.body}
            </p>
          ) : null}
          <div className="mt-2 flex gap-2">
            <Link
              href={`/messages?c=${banner.conversation_id}`}
              className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs text-primary-foreground"
              onClick={() => {
                void markSoftAlertReadAction(banner.id);
                setBanner(null);
              }}
            >
              Open thread
            </Link>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                void markSoftAlertReadAction(banner.id);
                setBanner(null);
                setAlerts((prev) => prev.filter((a) => a.id !== banner.id));
              }}
            >
              Dismiss
            </Button>
          </div>
          {alerts.length > 1 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              +{alerts.length - 1} more waiting
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
