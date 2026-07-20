'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/app/(app)/activity/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { NotificationRow } from '@/lib/data/activity';
import { cn } from '@/lib/utils';

type Props = {
  notifications: NotificationRow[];
  error: string | null;
};

export function NotificationInbox({ notifications, error }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const unread = notifications.filter((n) => !n.read_at && n.user_id).length;

  if (error) {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {error}
      </p>
    );
  }

  if (notifications.length === 0) {
    return (
      <EmptyState
        title="No notifications yet"
        description="Chat messages, new leads, and signed docs will appear here."
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 pb-1">
        <p className="text-xs text-muted-foreground">
          {unread > 0 ? `${unread} unread` : 'All caught up'}
        </p>
        {unread > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              start(async () => {
                await markAllNotificationsReadAction();
                router.refresh();
              });
            }}
          >
            Mark all read
          </Button>
        ) : null}
      </div>
      {notifications.map((row) => {
        const unreadRow = !row.read_at && Boolean(row.user_id);
        const isChat = row.kind === 'chat_message';
        const inner = (
          <div
            className={cn(
              'flex flex-wrap items-baseline justify-between gap-2 rounded-lg border px-3 py-2',
              unreadRow
                ? 'border-[#9f957c]/50 bg-[#9f957c]/10'
                : 'border-border',
            )}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {unreadRow ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-[#9f957c]" />
                ) : null}
                <p className="text-sm font-medium">{row.title}</p>
                {isChat ? (
                  <Badge variant="secondary" className="font-normal">
                    Chat
                  </Badge>
                ) : null}
              </div>
              {row.body ? (
                <p className="text-xs text-muted-foreground">{row.body}</p>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {new Date(row.created_at).toLocaleString()}
            </p>
          </div>
        );

        if (row.href) {
          return (
            <Link
              key={row.notification_id}
              href={row.href}
              className="block hover:opacity-90"
              onClick={() => {
                if (unreadRow) {
                  void markNotificationReadAction(row.notification_id);
                }
              }}
            >
              {inner}
            </Link>
          );
        }

        return (
          <button
            key={row.notification_id}
            type="button"
            className="block w-full text-left"
            onClick={() => {
              if (unreadRow) {
                start(async () => {
                  await markNotificationReadAction(row.notification_id);
                  router.refresh();
                });
              }
            }}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
