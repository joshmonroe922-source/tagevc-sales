'use client';

import { getUnreadNotificationsCountAction } from '@/app/(app)/activity/actions';
import { getNewNetworkContactsCountAction } from '@/app/(app)/my-card/actions';
import { getUnreadTotalAction } from '@/app/(app)/messages/actions';
import { createClient } from '@/lib/supabase/client';
import { createIdleCountStore } from '@/lib/ui/idle-count-store';

export const messagesUnreadStore = createIdleCountStore({
  fetchCount: async () => {
    const result = await getUnreadTotalAction();
    return result.ok ? result.count : 0;
  },
  subscribeRealtime: (onChange) => {
    const supabase = createClient();
    const channel = supabase
      .channel('os-messaging-unread-badge-shared')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'os_messages' },
        () => onChange(),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'os_conversation_members',
        },
        () => onChange(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  },
});

export const activityUnreadStore = createIdleCountStore({
  fetchCount: async () => {
    const result = await getUnreadNotificationsCountAction();
    return result.ok ? result.count : 0;
  },
  subscribeRealtime: (onChange) => {
    const supabase = createClient();
    const channel = supabase
      .channel('activity-notif-badge-shared')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_notifications' },
        () => onChange(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  },
});

export const networkInboxStore = createIdleCountStore({
  fetchCount: async () => {
    const result = await getNewNetworkContactsCountAction();
    return result.ok ? result.count : 0;
  },
  subscribeRealtime: (onChange) => {
    const supabase = createClient();
    const channel = supabase
      .channel('os-network-inbox-badge-shared')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'os_network_contacts' },
        () => onChange(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  },
});
