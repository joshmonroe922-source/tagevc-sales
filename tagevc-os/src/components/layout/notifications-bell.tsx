'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Bell } from 'lucide-react';
import {
  completeNotificationAction,
  listInboxNotificationsAction,
  markNotificationReadAction,
  markNotificationUnreadAction,
  saveDesktopPrefsAction,
} from '@/app/(app)/notifications/inbox-actions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Notif = {
  id: string;
  notification_id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  completed_at?: string | null;
  created_at: string;
};

export function NotificationsBell({
  initialUnread = 0,
  desktopEnabled = false,
  soundEnabled = false,
}: {
  initialUnread?: number;
  desktopEnabled?: boolean;
  soundEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(initialUnread);
  const [desktop, setDesktop] = useState(desktopEnabled);
  const [sound, setSound] = useState(soundEnabled);
  const [pending, start] = useTransition();
  const knownIds = useRef(new Set<string>());
  const audioCtx = useRef<AudioContext | null>(null);

  const refresh = useCallback(() => {
    start(async () => {
      const res = await listInboxNotificationsAction();
      if (!res.ok) return;
      setItems(res.notifications as Notif[]);
      setUnread(res.unread);
      for (const n of res.notifications) {
        knownIds.current.add(n.notification_id);
      }
    });
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 45_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!desktop || typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }
    if (Notification.permission !== 'granted') return;

    start(async () => {
      const res = await listInboxNotificationsAction();
      if (!res.ok) return;
      for (const n of res.notifications as Notif[]) {
        if (knownIds.current.has(n.notification_id)) continue;
        if (n.read_at) continue;
        knownIds.current.add(n.notification_id);
        try {
          new Notification(n.title, {
            body: n.body ?? undefined,
            tag: n.notification_id,
          });
        } catch {
          /* ignore */
        }
        if (sound) {
          try {
            if (!audioCtx.current) {
              audioCtx.current = new AudioContext();
            }
            const ctx = audioCtx.current;
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.connect(g);
            g.connect(ctx.destination);
            o.frequency.value = 880;
            g.gain.value = 0.04;
            o.start();
            o.stop(ctx.currentTime + 0.12);
          } catch {
            /* ignore */
          }
        }
      }
      setItems(res.notifications as Notif[]);
      setUnread(res.unread);
    });
  }, [desktop, sound, open]);

  async function enableDesktop() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    const enabled = perm === 'granted';
    setDesktop(enabled);
    await saveDesktopPrefsAction({ desktopEnabled: enabled, soundEnabled: sound });
  }

  return (
    <div className="relative">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="relative gap-1.5"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) refresh();
        }}
      >
        <Bell className="size-3.5" />
        <span className="hidden sm:inline">Alerts</span>
        {unread > 0 ? (
          <Badge
            variant="secondary"
            className="absolute -top-1.5 -right-1.5 h-4 min-w-4 justify-center px-1 text-[10px]"
          >
            {unread > 99 ? '99+' : unread}
          </Badge>
        ) : null}
      </Button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(100vw-2rem,22rem)] rounded-lg border border-border bg-background shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-medium">Notifications</p>
            <Link
              href="/activity"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setOpen(false)}
            >
              Activity
            </Link>
          </div>
          <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2 text-xs">
            <button
              type="button"
              className={cn(
                'rounded border px-2 py-0.5',
                desktop ? 'border-emerald-400 text-emerald-800' : 'border-border',
              )}
              onClick={() => void enableDesktop()}
            >
              {desktop ? 'Desktop on' : 'Enable desktop'}
            </button>
            <button
              type="button"
              className={cn(
                'rounded border px-2 py-0.5',
                sound ? 'border-emerald-400 text-emerald-800' : 'border-border',
              )}
              onClick={() => {
                const next = !sound;
                setSound(next);
                void saveDesktopPrefsAction({
                  desktopEnabled: desktop,
                  soundEnabled: next,
                });
              }}
            >
              Sound {sound ? 'on' : 'off'}
            </button>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-3 py-4 text-sm text-muted-foreground">
                No active notifications
              </li>
            ) : (
              items.map((n) => (
                <li
                  key={n.notification_id}
                  className={cn(
                    'border-b border-border/60 px-3 py-2 text-sm',
                    !n.read_at && 'bg-muted/40',
                  )}
                >
                  <div className="font-medium">{n.title}</div>
                  {n.body ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
                    {n.href ? (
                      <Link
                        href={n.href}
                        className="underline-offset-2 hover:underline"
                        onClick={() => setOpen(false)}
                      >
                        Open
                      </Link>
                    ) : null}
                    {n.read_at ? (
                      <button
                        type="button"
                        disabled={pending}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          start(async () => {
                            await markNotificationUnreadAction(n.notification_id);
                            refresh();
                          })
                        }
                      >
                        Mark unread
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          start(async () => {
                            await markNotificationReadAction(n.notification_id);
                            refresh();
                          })
                        }
                      >
                        Mark read
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={pending}
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        start(async () => {
                          await completeNotificationAction(n.notification_id);
                          refresh();
                        })
                      }
                    >
                      Complete
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
