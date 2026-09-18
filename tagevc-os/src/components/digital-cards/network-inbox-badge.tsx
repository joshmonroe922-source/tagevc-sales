'use client';

import { networkInboxStore } from '@/components/layout/nav-badge-stores';
import { Badge } from '@/components/ui/badge';
import { useIdleCount } from '@/lib/ui/use-idle-count';

/** Sidebar / nav badge for new card exchange contacts. */
export function NetworkInboxBadge() {
  const count = useIdleCount(networkInboxStore);
  if (count <= 0) return null;
  return (
    <Badge className="ml-auto h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5 text-[10px]">
      {count > 99 ? '99+' : count}
    </Badge>
  );
}
