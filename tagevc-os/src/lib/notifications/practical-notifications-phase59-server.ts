import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  PHASE59_NOTIFICATIONS_CONTRACT_VERSION,
  emptyPracticalNotificationsPhase59Report,
  type NotificationBoardStatus,
  type NotificationPrefsPhase59,
  type NotificationRouteKind,
  type NotificationSeverity,
  type PracticalNotificationsPhase59Report,
  defaultNotificationPrefsPhase59,
} from '@/lib/notifications/practical-notifications-phase59';

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value === 'string' &&
    value.trim() !== '' &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return null;
}

function asCount(value: unknown): number {
  const n = asNumber(value);
  return n != null && n >= 0 ? n : 0;
}

function asBoardStatus(value: unknown): NotificationBoardStatus {
  const raw = String(value ?? 'missing');
  if (
    raw === 'ok' ||
    raw === 'partial' ||
    raw === 'missing' ||
    raw === 'unknown'
  ) {
    return raw;
  }
  return 'unknown';
}

function normalizeReport(
  data: Record<string, unknown> | null | undefined,
  entityId: string | null,
): PracticalNotificationsPhase59Report {
  const empty = emptyPracticalNotificationsPhase59Report(entityId);
  if (!data) return empty;
  return {
    ...empty,
    entity_id:
      typeof data.entity_id === 'string'
        ? data.entity_id
        : data.entity_id === null
          ? null
          : entityId,
    unread_total: asCount(data.unread_total),
    unread_critical: asCount(data.unread_critical),
    unread_mentions: asCount(data.unread_mentions),
    unread_chat: asCount(data.unread_chat),
    unread_owner_routed: asCount(data.unread_owner_routed),
    prefs_configured: asCount(data.prefs_configured),
    board_status: asBoardStatus(data.board_status),
    snapshot_id:
      typeof data.snapshot_id === 'string' ? data.snapshot_id : null,
    captured_at:
      typeof data.captured_at === 'string' ? data.captured_at : null,
    critical_email_delivered_7d: asCount(data.critical_email_delivered_7d),
    critical_email_failed_7d: asCount(data.critical_email_failed_7d),
    recent_routes: Array.isArray(data.recent_routes)
      ? (data.recent_routes as Array<Record<string, unknown>>)
      : [],
    recent_deliveries: Array.isArray(data.recent_deliveries)
      ? (data.recent_deliveries as Array<Record<string, unknown>>)
      : [],
    recent_alerts: Array.isArray(data.recent_alerts)
      ? (data.recent_alerts as Array<Record<string, unknown>>)
      : [],
    entity_filter_hint: String(
      data.entity_filter_hint ?? empty.entity_filter_hint,
    ),
    todo: String(data.todo ?? empty.todo),
    full_push: false,
    email_critical_only: true,
    reuses_digest_route: true,
    reuses_notification_prefs: true,
    contract_version: PHASE59_NOTIFICATIONS_CONTRACT_VERSION,
  };
}

export async function getPracticalNotificationsPhase59Report(
  entityId: string | null = null,
): Promise<PracticalNotificationsPhase59Report> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'get_practical_notifications_phase59_report',
      { p_entity_id: entityId },
    );
    if (error) {
      console.error('practical notifications phase59 report', error.message);
      return emptyPracticalNotificationsPhase59Report(entityId);
    }
    return normalizeReport(
      (data ?? null) as Record<string, unknown> | null,
      entityId,
    );
  } catch (e) {
    console.error(
      'practical notifications phase59 report unavailable',
      e instanceof Error ? e.message : e,
    );
    return emptyPracticalNotificationsPhase59Report(entityId);
  }
}

export async function refreshNotificationInboxPhase59(input: {
  actorId?: string | null;
  entityId?: string | null;
}): Promise<PracticalNotificationsPhase59Report> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('refresh_notification_inbox_phase59', {
      p_actor_id: input.actorId ?? null,
      p_entity_id: input.entityId ?? null,
    });
    if (error) {
      console.error('refresh notification inbox phase59', error.message);
      return emptyPracticalNotificationsPhase59Report(input.entityId ?? null);
    }
    return normalizeReport(
      (data ?? null) as Record<string, unknown> | null,
      input.entityId ?? null,
    );
  } catch (e) {
    console.error(
      'refresh notification inbox phase59 unavailable',
      e instanceof Error ? e.message : e,
    );
    return emptyPracticalNotificationsPhase59Report(input.entityId ?? null);
  }
}

export async function routeNotificationPhase59(input: {
  entityId?: string | null;
  routeKind?: NotificationRouteKind;
  ownerUserId?: string | null;
  assigneeUserId?: string | null;
  recipientUserId?: string | null;
  eventKind: string;
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  href?: string | null;
  actorId?: string | null;
}): Promise<{ ok: boolean; error?: string; result?: Record<string, unknown> }> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('route_notification_phase59', {
      p_payload: {
        entity_id: input.entityId ?? null,
        route_kind: input.routeKind ?? 'both',
        owner_user_id: input.ownerUserId ?? null,
        assignee_user_id: input.assigneeUserId ?? null,
        recipient_user_id: input.recipientUserId ?? null,
        event_kind: input.eventKind,
        severity: input.severity ?? 'info',
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? '/activity',
        actor_id: input.actorId ?? null,
        detail: {
          full_push: false,
          contract_version: PHASE59_NOTIFICATIONS_CONTRACT_VERSION,
        },
      },
    });
    if (error) {
      return { ok: false, error: error.message };
    }
    return {
      ok: true,
      result: {
        ...((data ?? {}) as Record<string, unknown>),
        full_push: false,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Route failed',
    };
  }
}

export async function markCriticalEmailDeliveryPhase59(input: {
  entityId?: string | null;
  recipientUserId: string;
  deliveryStatus: 'delivered' | 'failed' | 'skipped_pref_off' | 'skipped_no_recipient';
  eventKind?: string;
  notificationRef?: string | null;
  actorId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const sb = await createPersistClient();
    const { error } = await sb.rpc('mark_critical_email_delivery_phase59', {
      p_payload: {
        entity_id: input.entityId ?? null,
        recipient_user_id: input.recipientUserId,
        delivery_status: input.deliveryStatus,
        event_kind: input.eventKind ?? 'critical_digest',
        severity: 'critical',
        notification_ref: input.notificationRef ?? null,
        actor_id: input.actorId ?? null,
        detail: {
          full_push: false,
          contract_version: PHASE59_NOTIFICATIONS_CONTRACT_VERSION,
        },
      },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Mark delivery failed',
    };
  }
}

export async function upsertNotificationPrefsPhase59(input: {
  emailDigests?: boolean;
  digestFrequency?: 'off' | 'daily' | 'weekly';
  notifyMentions?: boolean;
  notifyChatMessages?: boolean;
  emailCriticalDigests?: boolean;
  notifyCriticalEvents?: boolean;
  notifyOwnerAssignments?: boolean;
}): Promise<{ ok: boolean; prefs?: NotificationPrefsPhase59; error?: string }> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('upsert_notification_prefs_phase59', {
      p_email_digests: input.emailDigests ?? null,
      p_digest_frequency: input.digestFrequency ?? null,
      p_notify_mentions: input.notifyMentions ?? null,
      p_notify_chat_messages: input.notifyChatMessages ?? null,
      p_email_critical_digests: input.emailCriticalDigests ?? null,
      p_notify_critical_events: input.notifyCriticalEvents ?? null,
      p_notify_owner_assignments: input.notifyOwnerAssignments ?? null,
    });
    if (error) {
      return {
        ok: false,
        error: error.message.includes('upsert_notification_prefs_phase59')
          ? 'Apply Phase 59 SQL to enable practical notification preferences.'
          : error.message,
      };
    }
    const row = (data ?? {}) as Record<string, unknown>;
    const userId = String(row.user_id ?? '');
    return {
      ok: true,
      prefs: {
        ...defaultNotificationPrefsPhase59(userId),
        user_id: userId,
        email_digests: Boolean(row.email_digests),
        digest_frequency: (row.digest_frequency as NotificationPrefsPhase59['digest_frequency']) ?? 'daily',
        notify_mentions: Boolean(row.notify_mentions),
        notify_chat_messages: Boolean(row.notify_chat_messages),
        email_critical_digests: Boolean(row.email_critical_digests ?? true),
        notify_critical_events: Boolean(row.notify_critical_events ?? true),
        notify_owner_assignments: Boolean(row.notify_owner_assignments ?? true),
        muted_conversation_ids: Array.isArray(row.muted_conversation_ids)
          ? (row.muted_conversation_ids as string[])
          : [],
        updated_at: String(row.updated_at ?? new Date().toISOString()),
        full_push: false,
        contract_version: PHASE59_NOTIFICATIONS_CONTRACT_VERSION,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Save prefs failed',
    };
  }
}
