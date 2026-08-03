/**
 * Multi-tenant platform email contracts for Tage OS + subsidiary OS scaffolds.
 * entity_id scopes analytics and send history (ENT-FIRM, ENT-R619, ENT-INDA, …).
 */

export type PlatformEmailProvider = 'graph' | 'resend';

export type PlatformEmailSource =
  | 'compose'
  | 'bulk'
  | 'drip'
  | 'digest'
  | 'intake_alert'
  | 'system'
  | 'w9'
  | 'ap_invoice'
  | 'ecc_campaign'
  | 'unknown';

export type EntityScopedEmailMessage = {
  id: string;
  entity_id: string;
  provider: PlatformEmailProvider;
  source: PlatformEmailSource;
  tracking_token: string | null;
  resend_id: string | null;
  from_address: string | null;
  to_addresses: string[];
  subject: string;
  status: string;
  open_count: number;
  click_count: number;
  first_opened_at: string | null;
  last_opened_at: string | null;
  first_clicked_at: string | null;
  last_clicked_at: string | null;
  sent_by: string | null;
  tags: Record<string, unknown>;
  created_at: string;
};

export type PlatformEmailEventType = 'open' | 'click' | 'delivered' | 'bounced';

export type EntityScopedEmailEvent = {
  id: string;
  message_id: string | null;
  entity_id: string;
  tracking_token: string | null;
  event_type: PlatformEmailEventType | string;
  click_url: string | null;
  user_agent: string | null;
  ip_address: string | null;
  occurred_at: string;
};
