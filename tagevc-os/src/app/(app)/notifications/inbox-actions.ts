'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { getSessionContext } from '@/lib/rbac/session';
import { writeAuditEvent } from '@/lib/audit/write';

export async function listInboxNotificationsAction() {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false as const, error: 'Not signed in', notifications: [], unread: 0 };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('app_notifications')
      .select('*')
      .or(`user_id.eq.${ctx.profile.id},user_id.is.null`)
      .is('completed_at', null)
      .order('created_at', { ascending: false })
      .limit(40);

    if (error) {
      // Fallback if completed_at column missing
      const fallback = await supabase
        .from('app_notifications')
        .select('*')
        .or(`user_id.eq.${ctx.profile.id},user_id.is.null`)
        .order('created_at', { ascending: false })
        .limit(40);
      const rows = fallback.data ?? [];
      const unread = rows.filter(
        (r) => r.user_id === ctx.profile.id && !r.read_at,
      ).length;
      return {
        ok: true as const,
        notifications: rows,
        unread,
      };
    }

    const rows = data ?? [];
    const unread = rows.filter(
      (r) => r.user_id === ctx.profile.id && !r.read_at,
    ).length;
    return { ok: true as const, notifications: rows, unread };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : 'Failed',
      notifications: [],
      unread: 0,
    };
  }
}

export async function markNotificationReadAction(notificationId: string) {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false as const, error: 'Not signed in' };
  if (ctx.liveLookActive) return { ok: false as const, error: 'Live Look is read-only' };
  const supabase = await createClient();
  await supabase
    .from('app_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('notification_id', notificationId)
    .eq('user_id', ctx.profile.id);
  await writeAuditEvent({
    action: 'notification_action',
    title: `Notification marked read · ${notificationId}`,
    object_type: 'notification',
    object_id: notificationId,
  });
  revalidatePath('/');
  return { ok: true as const };
}

export async function markNotificationUnreadAction(notificationId: string) {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false as const, error: 'Not signed in' };
  if (ctx.liveLookActive) return { ok: false as const, error: 'Live Look is read-only' };
  const supabase = await createClient();
  await supabase
    .from('app_notifications')
    .update({ read_at: null })
    .eq('notification_id', notificationId)
    .eq('user_id', ctx.profile.id);
  await writeAuditEvent({
    action: 'notification_action',
    title: `Notification marked unread · ${notificationId}`,
    object_type: 'notification',
    object_id: notificationId,
  });
  revalidatePath('/');
  return { ok: true as const };
}

export async function completeNotificationAction(notificationId: string) {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false as const, error: 'Not signed in' };
  if (ctx.liveLookActive) return { ok: false as const, error: 'Live Look is read-only' };
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('app_notifications')
    .update({ completed_at: now, read_at: now })
    .eq('notification_id', notificationId)
    .eq('user_id', ctx.profile.id);
  if (error) {
    // Soft-fail if column missing: mark read only
    await supabase
      .from('app_notifications')
      .update({ read_at: now })
      .eq('notification_id', notificationId)
      .eq('user_id', ctx.profile.id);
  }
  await writeAuditEvent({
    action: 'notification_action',
    title: `Notification completed · ${notificationId}`,
    object_type: 'notification',
    object_id: notificationId,
  });
  revalidatePath('/');
  return { ok: true as const };
}

export async function saveDesktopPrefsAction(input: {
  desktopEnabled: boolean;
  soundEnabled: boolean;
}) {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false as const, error: 'Not signed in' };
  if (ctx.liveLookActive) return { ok: false as const, error: 'Live Look is read-only' };
  try {
    const sb = await createPersistClient();
    await sb.from('os_notification_desktop_prefs').upsert({
      profile_id: ctx.profile.id,
      desktop_enabled: input.desktopEnabled,
      sound_enabled: input.soundEnabled,
      updated_at: new Date().toISOString(),
    });
    return { ok: true as const };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : 'Failed',
    };
  }
}

export async function getDesktopPrefsAction() {
  const ctx = await getSessionContext();
  if (!ctx) {
    return { desktopEnabled: false, soundEnabled: false };
  }
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_notification_desktop_prefs')
      .select('desktop_enabled, sound_enabled')
      .eq('profile_id', ctx.profile.id)
      .maybeSingle();
    return {
      desktopEnabled: Boolean(data?.desktop_enabled),
      soundEnabled: Boolean(data?.sound_enabled),
    };
  } catch {
    return { desktopEnabled: false, soundEnabled: false };
  }
}
