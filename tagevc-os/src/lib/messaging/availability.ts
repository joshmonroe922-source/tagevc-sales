import { createPersistClient } from '@/lib/supabase/persist-client';

export type AvailabilityStatus = 'available' | 'dnd';
export type AvailabilitySource = 'manual' | 'calendar';

export type UserAvailability = {
  profile_id: string;
  status: AvailabilityStatus;
  source: AvailabilitySource;
  calendar_busy_until: string | null;
  microsoft_timezone: string | null;
  updated_at: string;
};

export function isEffectivelyDnd(row: UserAvailability | null | undefined): boolean {
  if (!row) return false;
  if (row.status === 'dnd') return true;
  if (row.calendar_busy_until) {
    const until = new Date(row.calendar_busy_until).getTime();
    if (!Number.isNaN(until) && until > Date.now()) return true;
  }
  return false;
}

export async function getAvailability(
  profileId: string,
): Promise<UserAvailability | null> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_user_availability')
      .select('*')
      .eq('profile_id', profileId)
      .maybeSingle();
    if (error || !data) return null;
    return data as UserAvailability;
  } catch {
    return null;
  }
}

export async function listAvailabilityForProfiles(
  profileIds: string[],
): Promise<Record<string, UserAvailability>> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  if (ids.length === 0) return {};
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_user_availability')
      .select('*')
      .in('profile_id', ids);
    if (error || !data) return {};
    const out: Record<string, UserAvailability> = {};
    for (const row of data as UserAvailability[]) {
      out[row.profile_id] = row;
    }
    return out;
  } catch {
    return {};
  }
}

export async function upsertAvailability(input: {
  profileId: string;
  status: AvailabilityStatus;
  source?: AvailabilitySource;
  calendarBusyUntil?: string | null;
  microsoftTimezone?: string | null;
}): Promise<{ ok: true; row: UserAvailability } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const payload = {
      profile_id: input.profileId,
      status: input.status,
      source: input.source ?? 'manual',
      calendar_busy_until: input.calendarBusyUntil ?? null,
      microsoft_timezone: input.microsoftTimezone ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await sb
      .from('os_user_availability')
      .upsert(payload, { onConflict: 'profile_id' })
      .select('*')
      .maybeSingle();
    if (error || !data) {
      return { ok: false, error: error?.message ?? 'Availability save failed' };
    }
    return { ok: true, row: data as UserAvailability };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Availability save failed',
    };
  }
}

export async function createSoftAlert(input: {
  profileId: string;
  conversationId: string;
  messageId?: string | null;
  kind: 'new_message' | 'urgent_dnd' | 'queued_release';
  title: string;
  body?: string | null;
  priority?: 'normal' | 'urgent';
  deferred?: boolean;
}): Promise<void> {
  try {
    const sb = await createPersistClient();
    await sb.from('os_message_soft_alerts').insert({
      profile_id: input.profileId,
      conversation_id: input.conversationId,
      message_id: input.messageId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      priority: input.priority ?? 'normal',
      deferred: input.deferred ?? false,
    });
  } catch {
    /* fail soft */
  }
}

export async function listActiveSoftAlerts(profileId: string, includeDeferred = false) {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_message_soft_alerts')
      .select('*')
      .eq('profile_id', profileId)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!includeDeferred) {
      q = q.eq('deferred', false);
    }
    const { data } = await q;
    return (data ?? []) as Array<{
      id: string;
      conversation_id: string;
      kind: string;
      title: string;
      body: string | null;
      priority: string;
      deferred: boolean;
      created_at: string;
    }>;
  } catch {
    return [];
  }
}

export async function releaseDeferredAlerts(profileId: string): Promise<number> {
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_message_soft_alerts')
      .update({ deferred: false, kind: 'queued_release' })
      .eq('profile_id', profileId)
      .eq('deferred', true)
      .is('read_at', null)
      .select('id');
    return data?.length ?? 0;
  } catch {
    return 0;
  }
}

export async function markSoftAlertRead(alertId: string, profileId: string) {
  try {
    const sb = await createPersistClient();
    await sb
      .from('os_message_soft_alerts')
      .update({ read_at: new Date().toISOString() })
      .eq('id', alertId)
      .eq('profile_id', profileId);
  } catch {
    /* fail soft */
  }
}
