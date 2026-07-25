import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { getSessionContext } from '@/lib/rbac/session';

export type ActivityModule =
  | 'vc'
  | 'ma'
  | 're'
  | 'shared_services'
  | 'documents'
  | 'portfolio'
  | 'auth'
  | 'system'
  | 'messages';

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
  impersonating_as: string | null;
  real_role: string | null;
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

export type ActivityListResult = {
  ok: boolean;
  events: ActivityEvent[];
  error: string | null;
};

export type NotificationRow = {
  id: string;
  notification_id: string;
  user_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationListResult = {
  ok: boolean;
  notifications: NotificationRow[];
  error: string | null;
};

export async function logActivity(
  input: LogActivityInput,
): Promise<ActivityEvent | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let impersonatingAs: string | null = null;
    let realRole: string | null = null;
    try {
      const ctx = await getSessionContext();
      if (ctx) {
        realRole = ctx.realRole;
        impersonatingAs = ctx.impersonatingAs;
      }
    } catch {
      // Session lookup is best-effort for audit enrichment.
    }

    const detailParts = [
      input.detail,
      impersonatingAs
        ? `viewing_as=${impersonatingAs}; real_role=${realRole ?? 'unknown'}`
        : null,
    ].filter(Boolean);

    const row = {
      event_id: `ACT-${randomUUID().slice(0, 8)}`,
      module: input.module,
      action: input.action,
      title: input.title,
      detail: detailParts.length ? detailParts.join(' · ') : null,
      entity_id: input.entity_id ?? null,
      ref_type: input.ref_type ?? null,
      ref_id: input.ref_id ?? null,
      actor_email: user?.email ?? null,
      actor_name:
        (user?.user_metadata?.full_name as string | undefined) ??
        (user?.user_metadata?.name as string | undefined) ??
        null,
      impersonating_as: impersonatingAs,
      real_role: realRole,
    };

    const { data, error } = await supabase
      .from('activity_events')
      .insert(row)
      .select('*')
      .maybeSingle();

    if (error) {
      // Columns may not exist until phase9 SQL — retry without new fields.
      if (
        error.message.includes('impersonating_as') ||
        error.message.includes('real_role')
      ) {
        const legacy = {
          event_id: row.event_id,
          module: row.module,
          action: row.action,
          title: row.title,
          detail: row.detail,
          entity_id: row.entity_id,
          ref_type: row.ref_type,
          ref_id: row.ref_id,
          actor_email: row.actor_email,
          actor_name: row.actor_name,
        };
        const retry = await supabase
          .from('activity_events')
          .insert(legacy)
          .select('*')
          .maybeSingle();
        if (retry.error) {
          console.error('logActivity', retry.error.message);
          return null;
        }
        return {
          ...(retry.data as ActivityEvent),
          impersonating_as: impersonatingAs,
          real_role: realRole,
        };
      }
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
): Promise<ActivityListResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('activity_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('listRecentActivity', error.message);
      return {
        ok: false,
        events: [],
        error:
          error.message.includes('activity_events') ||
          error.code === '42P01'
            ? 'Activity table unavailable. Apply Phase 7 SQL in Supabase.'
            : error.message,
      };
    }
    return {
      ok: true,
      events: (data ?? []).map((row) => {
        const event = row as ActivityEvent;
        return {
          ...event,
          impersonating_as: event.impersonating_as ?? null,
          real_role: event.real_role ?? null,
        };
      }),
      error: null,
    };
  } catch (e) {
    console.error('listRecentActivity', e);
    return {
      ok: false,
      events: [],
      error: e instanceof Error ? e.message : 'Failed to load activity',
    };
  }
}

export async function createUserNotification(input: {
  userId: string;
  kind: string;
  title: string;
  body?: string;
  href?: string;
}) {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from('app_notifications').insert({
      notification_id: `NTF-${randomUUID().slice(0, 8)}`,
      user_id: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
    });
    if (error) console.error('createUserNotification', error.message);
  } catch (e) {
    console.error('createUserNotification', e);
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

export async function listMyNotifications(
  limit = 20,
): Promise<NotificationListResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { ok: true, notifications: [], error: null };
    }

    const { data, error } = await supabase
      .from('app_notifications')
      .select('*')
      .or(`user_id.eq.${user.id},user_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('listMyNotifications', error.message);
      return {
        ok: false,
        notifications: [],
        error:
          error.message.includes('app_notifications') ||
          error.code === '42P01'
            ? 'Notifications table unavailable. Apply Phase 7 SQL in Supabase.'
            : error.message,
      };
    }
    return {
      ok: true,
      notifications: (data ?? []) as NotificationRow[],
      error: null,
    };
  } catch (e) {
    console.error('listMyNotifications', e);
    return {
      ok: false,
      notifications: [],
      error: e instanceof Error ? e.message : 'Failed to load notifications',
    };
  }
}

export async function markNotificationRead(notificationId: string) {
  try {
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
  } catch (e) {
    console.error('markNotificationRead', e);
  }
}

export async function markAllMyNotificationsRead() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false as const, error: 'Not signed in' };
    const { error } = await supabase
      .from('app_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('read_at', null);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : 'Failed to mark read',
    };
  }
}

export async function countMyUnreadNotifications(): Promise<number> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return 0;
    const { count, error } = await supabase
      .from('app_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
