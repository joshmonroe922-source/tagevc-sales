'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getUnreadTotalAction } from '@/app/(app)/messages/actions';
import { Badge } from '@/components/ui/badge';

export function MessagesUnreadBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const result = await getUnreadTotalAction();
      if (!cancelled && result.ok) setCount(result.count);
    }

    void refresh();

    const supabase = createClient();
    const channel = supabase
      .channel('os-messaging-unread-badge')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'os_messages' },
        () => {
          void refresh();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'os_conversation_members',
        },
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
  }, []);

  if (count <= 0) return null;

  return (
    <Badge className="ml-auto h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5 text-[10px]">
      {count > 99 ? '99+' : count}
    </Badge>
  );
}
