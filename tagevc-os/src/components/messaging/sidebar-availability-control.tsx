'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  getMyAvailabilityAction,
  setMyAvailabilityAction,
} from '@/app/(app)/messages/presence-actions';
import { cn } from '@/lib/utils';

/**
 * Compact chat availability control for the sidebar brand header.
 * Available → green dot; Do Not Disturb → red dot. Sidebar colors/fonts.
 */
export function SidebarAvailabilityControl() {
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

  function toggle() {
    const next = status === 'available' ? 'dnd' : 'available';
    startTransition(async () => {
      const res = await setMyAvailabilityAction(next);
      if (res.ok) {
        setStatus(res.status);
        setSource(res.source);
      }
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={toggle}
      title="Toggle Available / Do Not Disturb"
      className={cn(
        'mb-3 flex w-full items-center gap-2 rounded-md px-0 py-0.5 text-left',
        'text-xs font-medium tracking-[0.18em] text-sidebar-foreground/60 uppercase',
        'hover:text-sidebar-foreground/80 disabled:opacity-60',
      )}
    >
      <span
        className={cn(
          'inline-block size-2.5 shrink-0 rounded-full',
          status === 'available' ? 'bg-emerald-500' : 'bg-red-500',
        )}
        aria-hidden
      />
      <span>
        {status === 'available' ? 'Available' : 'Do Not Disturb'}
        {source === 'calendar' ? (
          <span className="normal-case tracking-normal opacity-70">
            {' '}
            · calendar
          </span>
        ) : null}
      </span>
    </button>
  );
}
