'use client';

/**
 * Portable Alerts bell shell (Tage AppTopBar pattern).
 * Copy into subsidiary `components/layout/alerts-bell.tsx` and wire
 * notifications (R619) or Tage presence soft-alerts (INDA / Signent).
 */
import { Bell } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function AlertsBellShell({
  unread = 0,
  open,
  onToggle,
  children,
}: {
  unread?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="relative gap-1.5"
        onClick={onToggle}
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
      {open ? children : null}
    </div>
  );
}
