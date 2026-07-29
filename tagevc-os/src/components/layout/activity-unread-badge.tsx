'use client';

import { useEffect, useId, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getUnreadNotificationsCountAction } from '@/app/(app)/activity/actions';
import { Badge } from '@/components/ui/badge';

export function ActivityUnreadBadge() {
  const [count, setCount] = useState(0);
  const instanceId = useId().replace(/:/g, '');

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const result = await getUnreadNotificationsCountAction();
      if (!cancelled && result.ok) setCount(result.count);
    }

    void refresh();
    const supabase = createClient();
    // Unique topic per mount — desktop + phone Menu drawer both render AppSidebar.
    // Reusing a subscribed channel and calling .on() again throws and crashes the app.
    const channel = supabase
      .channel(`activity-notif-badge-${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_notifications' },
        () => void refresh(),
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
