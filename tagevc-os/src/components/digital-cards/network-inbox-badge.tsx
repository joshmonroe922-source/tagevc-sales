'use client';

import { useEffect, useId, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getNewNetworkContactsCountAction } from '@/app/(app)/my-card/actions';
import { Badge } from '@/components/ui/badge';

/** Sidebar / nav badge for new card exchange contacts. */
export function NetworkInboxBadge() {
  const [count, setCount] = useState(0);
  const instanceId = useId().replace(/:/g, '');

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const result = await getNewNetworkContactsCountAction();
      if (!cancelled && result.ok) setCount(result.count);
    }

    void refresh();

    const supabase = createClient();
    const channel = supabase
      .channel(`os-network-inbox-badge-${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'os_network_contacts' },
        () => {
          void refresh();
        },
      )
      .subscribe();

    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      void supabase.removeChannel(channel);
    };
  }, [instanceId]);

  if (count <= 0) return null;

  return (
    <Badge className="ml-auto h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5 text-[10px]">
      {count > 99 ? '99+' : count}
    </Badge>
  );
}
