/**
 * Phase 59 — Practical Production Notifications contracts + stubs.
 * In-app inbox completeness, optional critical email digests, owner/assignee
 * routing, preference center. NOT a full push product (full_push always false).
 */

export const PHASE59_NOTIFICATIONS_CONTRACT_VERSION = 'phase59-v1' as const;
export const PHASE59_ENTITY_FILTER_HINT = 'ENT-R619';

export type NotificationBoardStatus = 'ok' | 'partial' | 'missing' | 'unknown';

export type NotificationRouteKind = 'owner' | 'assignee' | 'both' | 'explicit';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export type NotificationDeliveryChannel = 'in_app' | 'email_critical';

export type PracticalNotificationsPhase59Report = {
  entity_id: string | null;
  unread_total: number;
  unread_critical: number;
  unread_mentions: number;
  unread_chat: number;
  unread_owner_routed: number;
  prefs_configured: number;
  board_status: NotificationBoardStatus;
  snapshot_id: string | null;
  captured_at: string | null;
  critical_email_delivered_7d: number;
  critical_email_failed_7d: number;
  recent_routes: Array<Record<string, unknown>>;
  recent_deliveries: Array<Record<string, unknown>>;
  recent_alerts: Array<Record<string, unknown>>;
  entity_filter_hint: string;
  todo: string;
  full_push: false;
  email_critical_only: true;
  reuses_digest_route: true;
  reuses_notification_prefs: true;
  contract_version: typeof PHASE59_NOTIFICATIONS_CONTRACT_VERSION;
};

export type NotificationPrefsPhase59 = {
  user_id: string;
  email_digests: boolean;
  digest_frequency: 'off' | 'daily' | 'weekly';
  notify_mentions: boolean;
  notify_chat_messages: boolean;
  email_critical_digests: boolean;
  notify_critical_events: boolean;
  notify_owner_assignments: boolean;
  muted_conversation_ids: string[];
  updated_at: string;
  full_push: false;
  contract_version: typeof PHASE59_NOTIFICATIONS_CONTRACT_VERSION;
};

export function emptyPracticalNotificationsPhase59Report(
  entityId: string | null = null,
): PracticalNotificationsPhase59Report {
  return {
    entity_id: entityId,
    unread_total: 0,
    unread_critical: 0,
    unread_mentions: 0,
    unread_chat: 0,
    unread_owner_routed: 0,
    prefs_configured: 0,
    board_status: 'missing',
    snapshot_id: null,
    captured_at: null,
    critical_email_delivered_7d: 0,
    critical_email_failed_7d: 0,
    recent_routes: [],
    recent_deliveries: [],
    recent_alerts: [],
    entity_filter_hint: PHASE59_ENTITY_FILTER_HINT,
    // TODO: Refresh inbox board; wire owner/assignee routing for ENT-R619.
    todo: 'Refresh inbox board; route critical owner/assignee events; optional critical email via digest',
    full_push: false,
    email_critical_only: true,
    reuses_digest_route: true,
    reuses_notification_prefs: true,
    contract_version: PHASE59_NOTIFICATIONS_CONTRACT_VERSION,
  };
}

export function defaultNotificationPrefsPhase59(
  userId: string,
): NotificationPrefsPhase59 {
  return {
    user_id: userId,
    email_digests: true,
    digest_frequency: 'daily',
    notify_mentions: true,
    notify_chat_messages: true,
    email_critical_digests: true,
    notify_critical_events: true,
    notify_owner_assignments: true,
    muted_conversation_ids: [],
    updated_at: new Date().toISOString(),
    full_push: false,
    contract_version: PHASE59_NOTIFICATIONS_CONTRACT_VERSION,
  };
}

export function boardStatusLabel(status: string): string {
  if (status === 'ok') return 'OK';
  if (status === 'partial') return 'Partial';
  if (status === 'missing') return 'Missing';
  return 'Unknown';
}

export function severityLabel(severity: string): string {
  if (severity === 'critical') return 'Critical';
  if (severity === 'warning') return 'Warning';
  return 'Info';
}

export function channelLabel(channel: string): string {
  if (channel === 'email_critical') return 'Critical email';
  if (channel === 'in_app') return 'In-app';
  return channel;
}
