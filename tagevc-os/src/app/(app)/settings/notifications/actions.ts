'use server';

import { revalidatePath } from 'next/cache';
import { getSessionContext } from '@/lib/rbac/session';
import { createClient } from '@/lib/supabase/server';
import type { NotificationPrefs } from '@/lib/messaging/types';

async function requireUser() {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false as const, error: 'Not signed in' };
  return { ok: true as const, profile: ctx.profile };
}

const DEFAULT_PREFS = (
  userId: string,
): NotificationPrefs => ({
  user_id: userId,
  email_digests: true,
  digest_frequency: 'daily',
  notify_mentions: true,
  notify_chat_messages: true,
  muted_conversation_ids: [],
  updated_at: new Date().toISOString(),
});

export async function getNotificationPrefsAction() {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('os_notification_prefs')
    .select('*')
    .eq('user_id', auth.profile.id)
    .maybeSingle();

  if (error) {
    if (
      error.message.includes('os_notification_prefs') ||
      error.code === '42P01'
    ) {
      return { ok: true as const, prefs: DEFAULT_PREFS(auth.profile.id) };
    }
    return { ok: false as const, error: error.message };
  }

  if (!data) {
    return { ok: true as const, prefs: DEFAULT_PREFS(auth.profile.id) };
  }

  return {
    ok: true as const,
    prefs: {
      user_id: data.user_id as string,
      email_digests: Boolean(data.email_digests),
      digest_frequency: data.digest_frequency as NotificationPrefs['digest_frequency'],
      notify_mentions: Boolean(data.notify_mentions),
      notify_chat_messages: Boolean(data.notify_chat_messages),
      muted_conversation_ids: (data.muted_conversation_ids as string[]) ?? [],
      updated_at: String(data.updated_at),
    },
  };
}

export async function saveNotificationPrefsAction(input: {
  emailDigests?: boolean;
  digestFrequency?: 'off' | 'daily' | 'weekly';
  notifyMentions?: boolean;
  notifyChatMessages?: boolean;
}) {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('upsert_notification_prefs', {
    p_email_digests: input.emailDigests ?? null,
    p_digest_frequency: input.digestFrequency ?? null,
    p_notify_mentions: input.notifyMentions ?? null,
    p_notify_chat_messages: input.notifyChatMessages ?? null,
  });

  if (error) {
    return {
      ok: false as const,
      error: error.message.includes('upsert_notification_prefs')
        ? 'Apply Phase 13 SQL to enable notification preferences.'
        : error.message,
    };
  }

  revalidatePath('/settings/notifications');
  revalidatePath('/activity');
  return { ok: true as const, prefs: data as NotificationPrefs };
}
