'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { ChevronDown, MessageSquare } from 'lucide-react';
import {
  getMyAvailabilityAction,
  setMyAvailabilityAction,
} from '@/app/(app)/messages/presence-actions';
import { MessagesUnreadBadge } from '@/components/messaging/messages-unread-badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * Shared-shell Messaging control (AppSidebar brand header).
 * Primary opens /messages; caret sets Available / Do Not Disturb with a live status dot.
 */
export function SidebarMessagingControl({
  className,
}: {
  className?: string;
}) {
  const pathname = usePathname();
  const [status, setStatus] = useState<'available' | 'dnd'>('available');
  const [source, setSource] = useState<'manual' | 'calendar'>('manual');
  const [pending, startTransition] = useTransition();
  const active =
    pathname === '/messages' || pathname.startsWith('/messages/');

  useEffect(() => {
    startTransition(async () => {
      const avail = await getMyAvailabilityAction();
      if (avail.ok) {
        setStatus(avail.status);
        setSource(avail.source);
      }
    });
    const id = window.setInterval(() => {
      startTransition(async () => {
        const avail = await getMyAvailabilityAction();
        if (avail.ok) {
          setStatus(avail.status);
          setSource(avail.source);
        }
      });
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  function select(next: 'available' | 'dnd') {
    if (next === status) return;
    startTransition(async () => {
      const res = await setMyAvailabilityAction(next);
      if (res.ok) {
        setStatus(res.status);
        setSource(res.source);
      }
    });
  }

  return (
    <div
      className={cn(
        'inline-flex min-w-0 max-w-full items-stretch overflow-hidden rounded-md',
        active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : null,
        className,
      )}
      role="group"
      aria-label="Messaging and availability"
    >
      <Link
        href="/messages"
        title="Messaging"
        className={cn(
          'inline-flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1',
          'text-xs font-medium tracking-[0.14em] uppercase',
          active
            ? 'text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        )}
      >
        <span className="relative shrink-0">
          <MessageSquare className="size-3.5" aria-hidden />
          <span
            className={cn(
              'absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-sidebar',
              status === 'available' ? 'bg-emerald-500' : 'bg-red-500',
            )}
            aria-hidden
          />
        </span>
        <span className="min-w-0 truncate">Messaging</span>
        <MessagesUnreadBadge />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          disabled={pending}
          title={
            status === 'available'
              ? source === 'calendar'
                ? 'Available · calendar'
                : 'Available'
              : source === 'calendar'
                ? 'Do Not Disturb · calendar'
                : 'Do Not Disturb'
          }
          aria-label="Set availability"
          className={cn(
            'inline-flex shrink-0 items-center border-l px-1.5',
            active
              ? 'border-sidebar-accent-foreground/20 text-sidebar-accent-foreground'
              : 'border-sidebar-border text-sidebar-foreground/60 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
            'disabled:opacity-60',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
          )}
        >
          <span
            className={cn(
              'mr-1 inline-block size-2 shrink-0 rounded-full',
              status === 'available' ? 'bg-emerald-500' : 'bg-red-500',
            )}
            aria-hidden
          />
          <ChevronDown className="size-3 opacity-70" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} className="min-w-44">
          <DropdownMenuRadioGroup
            value={status}
            onValueChange={(value) => {
              if (value === 'available' || value === 'dnd') select(value);
            }}
          >
            <DropdownMenuRadioItem value="available" className="cursor-pointer">
              <span
                className="inline-block size-2 shrink-0 rounded-full bg-emerald-500"
                aria-hidden
              />
              Available
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dnd" className="cursor-pointer">
              <span
                className="inline-block size-2 shrink-0 rounded-full bg-red-500"
                aria-hidden
              />
              Do Not Disturb
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
