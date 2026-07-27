/**
 * Platform email contract — entity-scoped analytics for Tage + subsidiaries.
 *
 * Providers:
 * - `graph` — Microsoft Graph sendMail from connected user mailbox (individual + mass)
 * - `resend` — transactional / drip / auth (webhook events)
 */

export type PlatformEmailProvider = 'graph' | 'resend';

export type PlatformEmailStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'delivery_delayed'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'suppressed';

export type PlatformEmailSource =
  | 'compose'
  | 'bulk'
  | 'drip'
  | 'intake_alert'
  | 'auth'
  | 'system'
  | 'webhook'
  | 'unknown';

/** Canonical outbound row (maps to `os_platform_email_messages`). */
export type PlatformEmailMessage = {
  id: string;
  entity_id: string;
  provider: PlatformEmailProvider;
  source: PlatformEmailSource;
  /** Resend message id when provider=resend */
  resend_id: string | null;
  /** Opaque token for Graph open/click pixel */
  tracking_token: string | null;
  from_address: string | null;
  to_addresses: string[];
  subject: string;
  status: PlatformEmailStatus;
  open_count: number;
  click_count: number;
  first_opened_at: string | null;
  last_opened_at: string | null;
  first_clicked_at: string | null;
  last_clicked_at: string | null;
  delivered_at: string | null;
  sent_by_profile_id: string | null;
  campaign_id: string | null;
  tags: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PlatformEmailEventType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.opened'
  | 'email.clicked'
  | 'email.bounced'
  | 'email.complained'
  | 'email.failed'
  | 'email.suppressed'
  | 'email.delivery_delayed';

export type PlatformEmailEvent = {
  id: string;
  message_id: string | null;
  entity_id: string;
  event_type: PlatformEmailEventType | string;
  tracking_token: string | null;
  resend_id: string | null;
  recipient: string | null;
  click_url: string | null;
  user_agent: string | null;
  occurred_at: string;
};

export type PlatformEmailAnalyticsSummary = {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  open_rate: number | null;
  click_rate: number | null;
};

export function summarizePlatformEmailMessages(
  rows: Pick<
    PlatformEmailMessage,
    'status' | 'open_count' | 'click_count'
  >[],
): PlatformEmailAnalyticsSummary {
  let sent = 0;
  let delivered = 0;
  let opened = 0;
  let clicked = 0;
  let bounced = 0;
  for (const r of rows) {
    sent += 1;
    if (r.status === 'delivered' || r.open_count > 0 || r.click_count > 0) {
      delivered += 1;
    }
    if (r.open_count > 0) opened += 1;
    if (r.click_count > 0) clicked += 1;
    if (r.status === 'bounced' || r.status === 'failed') bounced += 1;
  }
  return {
    sent,
    delivered,
    opened,
    clicked,
    bounced,
    open_rate: sent > 0 ? opened / sent : null,
    click_rate: sent > 0 ? clicked / sent : null,
  };
}
