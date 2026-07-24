'use server';

import { revalidatePath } from 'next/cache';
import { getSessionContext } from '@/lib/rbac/session';
import {
  getAvailability,
  isEffectivelyDnd,
  listActiveSoftAlerts,
  markSoftAlertRead,
  releaseDeferredAlerts,
  upsertAvailability,
  type AvailabilityStatus,
} from '@/lib/messaging/availability';
import { fetchCalendarPresenceHint } from '@/lib/messaging/ms-calendar-presence';

async function requireProfile() {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Not signed in' };
  return { ok: true as const, profile: session.profile };
}

export async function getMyAvailabilityAction() {
  const auth = await requireProfile();
  if (!auth.ok) return auth;
  const row = await getAvailability(auth.profile.id);
  const status: AvailabilityStatus = isEffectivelyDnd(row) ? 'dnd' : 'available';
  return {
    ok: true as const,
    status: row?.status === 'dnd' || status === 'dnd' ? ('dnd' as const) : ('available' as const),
    source: row?.source ?? ('manual' as const),
    calendarBusyUntil: row?.calendar_busy_until ?? null,
    microsoftTimezone: row?.microsoft_timezone ?? null,
  };
}

export async function setMyAvailabilityAction(status: AvailabilityStatus) {
  const auth = await requireProfile();
  if (!auth.ok) return auth;
  if (status !== 'available' && status !== 'dnd') {
    return { ok: false as const, error: 'Invalid status' };
  }
  const saved = await upsertAvailability({
    profileId: auth.profile.id,
    status,
    source: 'manual',
  });
  if (!saved.ok) return saved;
  if (status === 'available') {
    await releaseDeferredAlerts(auth.profile.id);
  }
  revalidatePath('/messages');
  return {
    ok: true as const,
    status: saved.row.status,
    source: saved.row.source,
  };
}

export async function syncCalendarPresenceAction() {
  const auth = await requireProfile();
  if (!auth.ok) return auth;
  const hint = await fetchCalendarPresenceHint(auth.profile.email);
  const current = await getAvailability(auth.profile.id);
  // Only auto-set DND from calendar when user is not manually Available override
  // within the same session — if calendar busy, soft-set DND with calendar source.
  if (hint.busyUntil) {
    await upsertAvailability({
      profileId: auth.profile.id,
      status: 'dnd',
      source: 'calendar',
      calendarBusyUntil: hint.busyUntil,
      microsoftTimezone: hint.microsoftTimezone,
    });
  } else if (current?.source === 'calendar') {
    await upsertAvailability({
      profileId: auth.profile.id,
      status: 'available',
      source: 'calendar',
      calendarBusyUntil: null,
      microsoftTimezone: hint.microsoftTimezone ?? current.microsoft_timezone,
    });
    await releaseDeferredAlerts(auth.profile.id);
  } else if (hint.microsoftTimezone) {
    await upsertAvailability({
      profileId: auth.profile.id,
      status: current?.status ?? 'available',
      source: current?.source ?? 'manual',
      calendarBusyUntil: current?.calendar_busy_until ?? null,
      microsoftTimezone: hint.microsoftTimezone,
    });
  }
  return { ok: true as const, hint };
}

export async function listMySoftAlertsAction() {
  const auth = await requireProfile();
  if (!auth.ok) return auth;
  const row = await getAvailability(auth.profile.id);
  const dnd = isEffectivelyDnd(row);
  // While DND, only surface non-deferred urgent soft alerts
  const alerts = await listActiveSoftAlerts(auth.profile.id, false);
  const visible = dnd
    ? alerts.filter((a) => a.kind === 'urgent_dnd' || a.priority === 'urgent')
    : alerts;
  return { ok: true as const, alerts: visible, dnd };
}

export async function markSoftAlertReadAction(alertId: string) {
  const auth = await requireProfile();
  if (!auth.ok) return auth;
  await markSoftAlertRead(alertId, auth.profile.id);
  return { ok: true as const };
}
