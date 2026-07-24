'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import {
  listMySoftAlertsAction,
  markSoftAlertReadAction,
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
 * Soft message alerts only — availability lives in the sidebar brand header.
 */
export function MessagePresenceHost() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState<AlertRow | null>(null);

  function refresh() {
    startTransition(async () => {
      await syncCalendarPresenceAction().catch(() => undefined);
      const soft = await listMySoftAlertsAction();
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

  if (!banner) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
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
            disabled={pending}
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
    </div>
  );
}
