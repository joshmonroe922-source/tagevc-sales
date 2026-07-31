/** Partner spine shared types (DB row shapes + connection status). */

import type { PartnerKey, PartnerOwnerSs } from '@/lib/partners/catalog';

export type PartnerConnectionStatus =
  | 'not_configured'
  | 'scaffold'
  | 'scaffolded'
  | 'configured'
  | 'live'
  | 'error'
  | 'disabled';

export type PartnerEntityBinding = {
  id: string;
  partner_key: PartnerKey;
  entity_id: string;
  enabled: boolean;
  status: PartnerConnectionStatus;
  external_account_id: string | null;
  config: Record<string, unknown>;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnerVendorContract = {
  id: string;
  partner_key: PartnerKey;
  entity_id: string | null;
  vendor_name: string;
  contract_title: string;
  status: 'draft' | 'active' | 'expired' | 'cancelled' | 'renewal_due';
  starts_on: string | null;
  ends_on: string | null;
  amount_cents: number | null;
  currency: string;
  payment_cadence: string | null;
  document_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnerVendorPayment = {
  id: string;
  contract_id: string;
  paid_on: string;
  amount_cents: number;
  currency: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
};

export type MarketingPresenceKind =
  | 'google_business'
  | 'google_analytics'
  | 'linkedin_company';

export type MarketingPresenceProperty = {
  id: string;
  kind: MarketingPresenceKind;
  entity_id: string;
  label: string;
  external_id: string | null;
  status: PartnerConnectionStatus;
  config: Record<string, unknown>;
  last_import_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnerEventKind =
  | 'webhook'
  | 'import'
  | 'provision'
  | 'revoke'
  | 'commission_push'
  | 'sync'
  | 'bi_signal';

export type PartnerEvent = {
  id: string;
  partner_key: PartnerKey;
  entity_id: string | null;
  kind: PartnerEventKind;
  status: 'received' | 'processed' | 'failed' | 'ignored';
  external_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type PartnerBiSignal = {
  id: string;
  partner_key: PartnerKey;
  entity_id: string | null;
  metric_key: string;
  metric_label: string;
  value_num: number | null;
  value_text: string | null;
  observed_at: string;
  meta: Record<string, unknown>;
};

export type CommissionPayrollStub = {
  id: string;
  entity_id: string;
  user_id: string | null;
  invoice_id: string | null;
  commission_cents: number;
  currency: string;
  status: 'calculated' | 'pending_push' | 'pushed' | 'failed' | 'waived';
  gusto_ref: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnerHubCard = {
  key: PartnerKey;
  label: string;
  ownerSs: PartnerOwnerSs;
  status: PartnerConnectionStatus;
  summary: string;
  href: string;
  envReady: boolean;
};
