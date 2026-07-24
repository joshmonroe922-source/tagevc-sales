/**
 * Durable SSC notifications — os_ssc_ops_alerts + app_notifications fallback.
 * Ticket creation remains the hard escalation guarantee (see escalate.ts).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';

const FIRM_NOTIFY_ROLES = [
  'visionary',
  'partner',
  'coo',
  'service_lead',
  'counsel_ops',
  'admin',
] as const;

export type SscNotifyInput = {
  entity_id: string | null;
  alert_kind?:
    | 'ssc_overdue_escalation'
    | 'ssc_cadence_failed'
    | 'ssc_audit_open'
    | 'ssc_sync_stale';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  href?: string;
  ticket_id?: string | null;
  task_id?: string | null;
  /** Stable dedupe key — unique on os_ssc_ops_alerts.window_key */
  window_key: string;
  detail?: Record<string, unknown>;
};

export type SscNotifyResult = {
  ops_alert: boolean;
  app_notifications: number;
};

export async function writeSscNotifications(
  input: SscNotifyInput,
): Promise<SscNotifyResult> {
  const result: SscNotifyResult = { ops_alert: false, app_notifications: 0 };
  const supabase = await createPersistClient();

  // 1) Durable SSC ops alert (schema we own)
  try {
    const { error } = await supabase.from('os_ssc_ops_alerts').insert({
      entity_id: input.entity_id,
      alert_kind: input.alert_kind ?? 'ssc_overdue_escalation',
      severity: input.severity,
      title: input.title,
      body: input.body,
      href: input.href ?? '/shared-services/checklists',
      ticket_id: input.ticket_id ?? null,
      task_id: input.task_id ?? null,
      window_key: input.window_key,
      detail: {
        ...(input.detail ?? {}),
        full_push: false,
        source: 'ssc_phase67',
      },
    });
    if (!error) result.ops_alert = true;
  } catch {
    // fail-soft
  }

  // 2) In-app notifications for firm SSC leaders
  try {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, role, active')
      .in('role', [...FIRM_NOTIFY_ROLES])
      .eq('active', true)
      .limit(40);

    const kind =
      input.severity === 'critical' ? 'critical_event' : 'ssc_ops';
    const rows = (profiles ?? []).map((p) => ({
      notification_id: `ssc:${input.window_key}:${p.id}`,
      user_id: p.id,
      kind,
      title: input.title,
      body: input.body,
      href: input.href ?? '/shared-services/checklists',
    }));

    for (const row of rows) {
      const { error } = await supabase.from('app_notifications').insert(row);
      if (!error) result.app_notifications += 1;
      // ignore unique conflicts (already notified)
    }
  } catch {
    // fail-soft
  }

  return result;
}
