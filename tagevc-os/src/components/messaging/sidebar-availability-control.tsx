'use client';

import { useEffect, useState, useTransition } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  getMyAvailabilityAction,
  setMyAvailabilityAction,
} from '@/app/(app)/messages/presence-actions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * Compact chat availability control for the sidebar brand header.
 * Dropdown: Available (green) ↔ Do Not Disturb (red). Same presence APIs.
 */
export function SidebarAvailabilityControl({
  className,
}: {
  className?: string;
}) {
  const [status, setStatus] = useState<'available' | 'dnd'>('available');
  const [source, setSource] = useState<'manual' | 'calendar'>('manual');
  const [pending, startTransition] = useTransition();

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
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={pending}
        title="Set availability"
        aria-label="Set availability"
        className={cn(
          'flex min-w-0 items-center gap-1.5 rounded-md py-0.5 text-left',
          'text-xs font-medium tracking-[0.14em] text-sidebar-foreground/60 uppercase',
          'hover:text-sidebar-foreground/80 disabled:opacity-60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
          className,
        )}
      >
        <span
          className={cn(
            'inline-block size-2.5 shrink-0 rounded-full',
            status === 'available' ? 'bg-emerald-500' : 'bg-red-500',
          )}
          aria-hidden
        />
        <span className="min-w-0 truncate">
          {status === 'available' ? 'Available' : 'Do Not Disturb'}
          {source === 'calendar' ? (
            <span className="normal-case tracking-normal opacity-70">
              {' '}
              · calendar
            </span>
          ) : null}
        </span>
        <ChevronDown className="size-3 shrink-0 opacity-70" aria-hidden />
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
  );
}
