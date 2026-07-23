'use server';

import { revalidatePath } from 'next/cache';
import { getSessionContext } from '@/lib/rbac/session';
import { createClient } from '@/lib/supabase/server';
import type { NotificationPrefs } from '@/lib/messaging/types';
import {
  defaultNotificationPrefsPhase59,
  emptyPracticalNotificationsPhase59Report,
  type PracticalNotificationsPhase59Report,
} from '@/lib/notifications/practical-notifications-phase59';
import {
  getPracticalNotificationsPhase59Report,
  refreshNotificationInboxPhase59,
  routeNotificationPhase59,
} from '@/lib/notifications/practical-notifications-phase59-server';

async function requireUser() {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false as const, error: 'Not signed in' };
  return { ok: true as const, profile: ctx.profile, ctx };
}

const DEFAULT_PREFS = (userId: string): NotificationPrefs => {
  const p = defaultNotificationPrefsPhase59(userId);
  return {
    user_id: p.user_id,
    email_digests: p.email_digests,
    digest_frequency: p.digest_frequency,
    notify_mentions: p.notify_mentions,
    notify_chat_messages: p.notify_chat_messages,
    email_critical_digests: p.email_critical_digests,
    notify_critical_events: p.notify_critical_events,
    notify_owner_assignments: p.notify_owner_assignments,
    muted_conversation_ids: p.muted_conversation_ids,
    updated_at: p.updated_at,
  };
};

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
      digest_frequency:
        data.digest_frequency as NotificationPrefs['digest_frequency'],
      notify_mentions: Boolean(data.notify_mentions),
      notify_chat_messages: Boolean(data.notify_chat_messages),
      email_critical_digests:
        data.email_critical_digests == null
          ? true
          : Boolean(data.email_critical_digests),
      notify_critical_events:
        data.notify_critical_events == null
          ? true
          : Boolean(data.notify_critical_events),
      notify_owner_assignments:
        data.notify_owner_assignments == null
          ? true
          : Boolean(data.notify_owner_assignments),
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
  emailCriticalDigests?: boolean;
  notifyCriticalEvents?: boolean;
  notifyOwnerAssignments?: boolean;
}) {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const supabase = await createClient();

  // Prefer Phase 59 upsert (includes critical + owner prefs); fall back to P13.
  const { data: phase59Data, error: phase59Error } = await supabase.rpc(
    'upsert_notification_prefs_phase59',
    {
      p_email_digests: input.emailDigests ?? null,
      p_digest_frequency: input.digestFrequency ?? null,
      p_notify_mentions: input.notifyMentions ?? null,
      p_notify_chat_messages: input.notifyChatMessages ?? null,
      p_email_critical_digests: input.emailCriticalDigests ?? null,
      p_notify_critical_events: input.notifyCriticalEvents ?? null,
      p_notify_owner_assignments: input.notifyOwnerAssignments ?? null,
    },
  );

  if (!phase59Error && phase59Data) {
    const row = phase59Data as Record<string, unknown>;
    revalidatePath('/settings/notifications');
    revalidatePath('/activity');
    return {
      ok: true as const,
      prefs: {
        user_id: String(row.user_id ?? auth.profile.id),
        email_digests: Boolean(row.email_digests),
        digest_frequency: (row.digest_frequency as NotificationPrefs['digest_frequency']) ?? 'daily',
        notify_mentions: Boolean(row.notify_mentions),
        notify_chat_messages: Boolean(row.notify_chat_messages),
        email_critical_digests: Boolean(row.email_critical_digests ?? true),
        notify_critical_events: Boolean(row.notify_critical_events ?? true),
        notify_owner_assignments: Boolean(row.notify_owner_assignments ?? true),
        muted_conversation_ids: Array.isArray(row.muted_conversation_ids)
          ? (row.muted_conversation_ids as string[])
          : [],
        updated_at: String(row.updated_at ?? new Date().toISOString()),
      } satisfies NotificationPrefs,
    };
  }

  const { data, error } = await supabase.rpc('upsert_notification_prefs', {
    p_email_digests: input.emailDigests ?? null,
    p_digest_frequency: input.digestFrequency ?? null,
    p_notify_mentions: input.notifyMentions ?? null,
    p_notify_chat_messages: input.notifyChatMessages ?? null,
  });

  if (error) {
    return {
      ok: false as const,
      error:
        phase59Error?.message?.includes('upsert_notification_prefs_phase59')
          ? 'Apply Phase 59 SQL to enable practical notification preferences.'
          : error.message.includes('upsert_notification_prefs')
            ? 'Apply Phase 13/59 SQL to enable notification preferences.'
            : error.message,
    };
  }

  revalidatePath('/settings/notifications');
  revalidatePath('/activity');
  return {
    ok: true as const,
    prefs: {
      ...(data as NotificationPrefs),
      email_critical_digests: input.emailCriticalDigests ?? true,
      notify_critical_events: input.notifyCriticalEvents ?? true,
      notify_owner_assignments: input.notifyOwnerAssignments ?? true,
    },
  };
}

export async function refreshNotificationInboxPhase59Action(
  entityId: string | null = null,
) {
  const auth = await requireUser();
  if (!auth.ok) {
    return {
      ok: false as const,
      error: auth.error,
      report: emptyPracticalNotificationsPhase59Report(entityId),
    };
  }

  const report = await refreshNotificationInboxPhase59({
    actorId: auth.profile.id,
    entityId,
  });
  revalidatePath('/settings/notifications');
  revalidatePath('/activity');
  return { ok: true as const, report };
}

export async function getPracticalNotificationsPhase59ReportAction(
  entityId: string | null = null,
): Promise<PracticalNotificationsPhase59Report> {
  return getPracticalNotificationsPhase59Report(entityId);
}

export async function routeDemoNotificationPhase59Action(input: {
  entityId?: string | null;
  severity: 'info' | 'critical';
}) {
  const auth = await requireUser();
  if (!auth.ok) {
    return {
      ok: false as const,
      error: auth.error,
      report: emptyPracticalNotificationsPhase59Report(input.entityId ?? null),
    };
  }

  const routed = await routeNotificationPhase59({
    entityId: input.entityId ?? null,
    routeKind: 'owner',
    ownerUserId: auth.profile.id,
    eventKind:
      input.severity === 'critical' ? 'critical_demo' : 'owner_assignment_demo',
    severity: input.severity,
    title:
      input.severity === 'critical'
        ? 'Critical demo event (Phase 59)'
        : 'Owner assignment demo (Phase 59)',
    body:
      input.severity === 'critical'
        ? 'Optional critical email digest candidate. In-app delivery recorded.'
        : 'Owner/assignee routing demo for preference center.',
    href: '/activity',
    actorId: auth.profile.id,
  });

  if (!routed.ok) {
    return {
      ok: false as const,
      error: routed.error ?? 'Route failed',
      report: emptyPracticalNotificationsPhase59Report(input.entityId ?? null),
    };
  }

  const report = await refreshNotificationInboxPhase59({
    actorId: auth.profile.id,
    entityId: input.entityId ?? null,
  });
  revalidatePath('/settings/notifications');
  revalidatePath('/activity');
  return { ok: true as const, report };
}
