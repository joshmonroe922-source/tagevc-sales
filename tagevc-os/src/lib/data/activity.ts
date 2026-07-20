import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';

export type ActivityModule =
  | 'vc'
  | 'ma'
  | 're'
  | 'shared_services'
  | 'documents'
  | 'portfolio'
  | 'auth'
  | 'system';

export type ActivityEvent = {
  id: string;
  event_id: string;
  module: ActivityModule;
  action: string;
  title: string;
  detail: string | null;
  entity_id: string | null;
  ref_type: string | null;
  ref_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  created_at: string;
};

export type LogActivityInput = {
  module: ActivityModule;
  action: string;
  title: string;
  detail?: string;
  entity_id?: string;
  ref_type?: string;
  ref_id?: string;
};

export async function logActivity(
  input: LogActivityInput,
): Promise<ActivityEvent | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const row = {
      event_id: `ACT-${randomUUID().slice(0, 8)}`,
      module: input.module,
      action: input.action,
      title: input.title,
      detail: input.detail ?? null,
      entity_id: input.entity_id ?? null,
      ref_type: input.ref_type ?? null,
      ref_id: input.ref_id ?? null,
      actor_email: user?.email ?? null,
      actor_name:
        (user?.user_metadata?.full_name as string | undefined) ??
        (user?.user_metadata?.name as string | undefined) ??
        null,
    };

    const { data, error } = await supabase
      .from('activity_events')
      .insert(row)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('logActivity', error.message);
      return null;
    }
    return data as ActivityEvent;
  } catch (e) {
    console.error('logActivity', e);
    return null;
  }
}

export async function listRecentActivity(
  limit = 25,
): Promise<ActivityEvent[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('activity_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('listRecentActivity', error.message);
      return [];
    }
    return (data ?? []) as ActivityEvent[];
  } catch (e) {
    console.error('listRecentActivity', e);
    return [];
  }
}

export async function createBroadcastNotification(input: {
  kind: string;
  title: string;
  body?: string;
  href?: string;
}) {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from('app_notifications').insert({
      notification_id: `NTF-${randomUUID().slice(0, 8)}`,
      user_id: null,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
    });
    if (error) console.error('createBroadcastNotification', error.message);
  } catch (e) {
    console.error('createBroadcastNotification', e);
  }
}

export async function listMyNotifications(limit = 20) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('app_notifications')
      .select('*')
      .or(`user_id.eq.${user.id},user_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('listMyNotifications', error.message);
      return [];
    }
    return data ?? [];
  } catch (e) {
    console.error('listMyNotifications', e);
    return [];
  }
}

export async function markNotificationRead(notificationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('app_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('notification_id', notificationId)
    .eq('user_id', user.id);
}
