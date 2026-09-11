/**
 * HRIS cadence notifications — in-app Alerts bell via app_notifications.
 * Ticket creation remains the hard guarantee for overdue steps (escalate.ts).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';

/** Firm leaders who should see HR onboarding cadence pings (Josh = visionary). */
const HRIS_NOTIFY_ROLES = [
  'visionary',
  'partner',
  'coo',
  'service_lead',
  'counsel_ops',
  'admin',
] as const;

export type HrisNotifyInput = {
  entity_id: string | null;
  alert_kind?:
    | 'hris_overdue_escalation'
    | 'hris_due_today'
    | 'hris_due_digest'
    | 'hris_cadence_failed';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  href?: string;
  ticket_id?: string | null;
  step_id?: string | null;
  /** Stable dedupe key — encoded in app_notifications.notification_id */
  window_key: string;
  detail?: Record<string, unknown>;
};

export type HrisNotifyResult = {
  app_notifications: number;
};

export async function writeHrisNotifications(
  input: HrisNotifyInput,
): Promise<HrisNotifyResult> {
  const result: HrisNotifyResult = { app_notifications: 0 };
  const supabase = await createPersistClient();

  try {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, role, active')
      .in('role', [...HRIS_NOTIFY_ROLES])
      .eq('active', true)
      .limit(40);

    const kind =
      input.severity === 'critical' ? 'critical_event' : 'hris_ops';
    const href = input.href ?? '/shared-services/hr/onboarding';

    for (const p of profiles ?? []) {
      const row = {
        notification_id: `hris:${input.window_key}:${p.id}`,
        user_id: p.id,
        kind,
        title: input.title,
        body: input.body,
        href,
      };
      const { error } = await supabase.from('app_notifications').insert(row);
      if (!error) result.app_notifications += 1;
      // ignore unique conflicts (already notified for this window)
    }
  } catch {
    // fail-soft
  }

  return result;
}
