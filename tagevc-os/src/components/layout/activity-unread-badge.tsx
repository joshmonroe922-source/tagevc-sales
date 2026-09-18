'use client';

import { activityUnreadStore } from '@/components/layout/nav-badge-stores';
import { Badge } from '@/components/ui/badge';
import { useIdleCount } from '@/lib/ui/use-idle-count';

export function ActivityUnreadBadge() {
  const count = useIdleCount(activityUnreadStore);
  if (count <= 0) return null;
  return (
    <Badge className="ml-auto h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5 text-[10px]">
      {count > 99 ? '99+' : count}
    </Badge>
  );
}
