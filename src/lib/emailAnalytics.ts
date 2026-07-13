import { requireSupabase } from './supabase';
import { formatDateTime } from './types';

export type EmailMessage = {
  id: string;
  resend_id: string;
  message_id: string | null;
  lead_id: string | null;
  source: string;
  from_address: string | null;
  to_addresses: string[];
  subject: string;
  reply_to: string | null;
  tags: Record<string, unknown>;
  status: string;
  open_count: number;
  click_count: number;
  first_opened_at: string | null;
  last_opened_at: string | null;
  first_clicked_at: string | null;
  last_clicked_at: string | null;
  delivered_at: string | null;
  bounced_at: string | null;
  sent_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EmailEvent = {
  id: string;
  message_id: string | null;
  resend_id: string;
  svix_id: string | null;
  event_type: string;
  recipient: string | null;
  click_url: string | null;
  user_agent: string | null;
  ip_address: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
};

export const EMAIL_SOURCE_LABELS: Record<string, string> = {
  intake_alert: 'Intake alert',
  drip_lead: 'Drip to lead',
  drip_reminder: 'Drip reminder',
  portal_tracked: 'Portal tracked',
  webhook: 'Webhook (unmatched)',
  auth: 'Auth',
  unknown: 'Unknown',
};

export const EMAIL_EVENT_LABELS: Record<string, string> = {
  'email.sent': 'Sent',
  'email.delivered': 'Delivered',
  'email.delivery_delayed': 'Delivery delayed',
  'email.opened': 'Opened',
  'email.clicked': 'Clicked',
  'email.bounced': 'Bounced',
  'email.complained': 'Spam complaint',
  'email.failed': 'Failed',
  'email.suppressed': 'Suppressed',
};

export type EmailAnalyticsFilters = {
  source?: string;
  recipient?: string;
  since?: string;
  until?: string;
  leadId?: string;
  limit?: number;
};

export async function listEmailMessages(
  filters: EmailAnalyticsFilters = {},
): Promise<EmailMessage[]> {
  let q = requireSupabase()
    .from('sales_email_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 150);

  if (filters.source) q = q.eq('source', filters.source);
  if (filters.leadId) q = q.eq('lead_id', filters.leadId);
  if (filters.since) q = q.gte('created_at', filters.since);
  if (filters.until) q = q.lte('created_at', filters.until);
  if (filters.recipient) {
    q = q.contains('to_addresses', [filters.recipient.trim().toLowerCase()]);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EmailMessage[];
}

export async function listEmailEventsForMessage(
  messageId: string,
  limit = 100,
): Promise<EmailEvent[]> {
  const { data, error } = await requireSupabase()
    .from('sales_email_events')
    .select('*')
    .eq('message_id', messageId)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as EmailEvent[];
}

export async function listRecentEmailEvents(limit = 80): Promise<EmailEvent[]> {
  const { data, error } = await requireSupabase()
    .from('sales_email_events')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as EmailEvent[];
}

export type EmailAnalyticsSummary = {
  sent: number;
  opened: number;
  clicked: number;
  bounced: number;
  totalOpens: number;
  totalClicks: number;
};

export function summarizeMessages(rows: EmailMessage[]): EmailAnalyticsSummary {
  let opened = 0;
  let clicked = 0;
  let bounced = 0;
  let totalOpens = 0;
  let totalClicks = 0;
  for (const m of rows) {
    if (m.open_count > 0) opened += 1;
    if (m.click_count > 0) clicked += 1;
    if (m.status === 'bounced') bounced += 1;
    totalOpens += m.open_count;
    totalClicks += m.click_count;
  }
  return {
    sent: rows.length,
    opened,
    clicked,
    bounced,
    totalOpens,
    totalClicks,
  };
}

export function formatEmailWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  return formatDateTime(iso);
}
