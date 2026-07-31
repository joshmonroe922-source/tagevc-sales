/**
 * Partner platform spine — shared types for all entities / future OS clones.
 * Secrets never live here; only keys, statuses, and connection paths.
 */

export const PARTNER_SPINE_CONTRACT_VERSION = 'partner-spine-v1' as const;

export type PartnerKey =
  | 'dialpad'
  | 'verified_first'
  | 'mybasepay'
  | 'apollo'
  | 'gusto'
  | 'docusign'
  | 'linkedin_recruiter'
  | 'appcast'
  | 'google_business'
  | 'google_analytics'
  | 'linkedin_company_pages';

export type PartnerCategory =
  | 'communications'
  | 'screening'
  | 'eor'
  | 'data'
  | 'payroll'
  | 'esignature'
  | 'recruiting'
  | 'job_publish'
  | 'marketing_presence'
  | 'analytics';

export type PartnerOwnerFunction =
  | 'IT'
  | 'HR'
  | 'Finance'
  | 'Marketing'
  | 'Legal'
  | 'Recruiting'
  | 'Shared';

export type PartnerConnectionStatus =
  | 'not_configured'
  | 'scaffold'
  | 'configured'
  | 'live'
  | 'degraded'
  | 'disabled';

export type PartnerScopeMode =
  | 'firm_wide'
  | 'all_entities'
  | 'recruit_first'
  | 'marketing_all_entities';

export type PartnerCatalogEntry = {
  key: PartnerKey;
  name: string;
  category: PartnerCategory;
  ownerFunction: PartnerOwnerFunction;
  summary: string;
  /** Where operators manage connection / contracts. */
  manageHref: string;
  docsPath: string;
  scopeMode: PartnerScopeMode;
  /** Env var names Josh must set (never invent values). */
  envKeys: string[];
  /** Optional LIVE kill-switch env (fail-closed when unset / 0). */
  liveEnvKey?: string;
  supportsImport: boolean;
  supportsWebhook: boolean;
  supportsAutoProvision: boolean;
  biSignals: string[];
  /** Immediate implementation focus (others are architected). */
  implementNow: Array<'ENT-FIRM' | 'ENT-R619' | 'ENT-SIGNENT' | 'ENT-INDA' | 'all'>;
};

export type PartnerEntityEnablement = {
  id: string;
  partner_key: PartnerKey;
  entity_id: string;
  enabled: boolean;
  status: PartnerConnectionStatus;
  external_account_ref: string | null;
  config_meta: Record<string, unknown>;
  notes: string | null;
  last_synced_at: string | null;
  updated_at: string;
};

export type PartnerContract = {
  id: string;
  partner_key: PartnerKey;
  entity_id: string | null;
  vendor_name: string;
  contract_title: string;
  status: 'draft' | 'active' | 'expiring' | 'expired' | 'cancelled';
  starts_on: string | null;
  ends_on: string | null;
  renewal_on: string | null;
  payment_cadence: string | null;
  payment_amount: number | null;
  payment_currency: string;
  storage_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingPresenceKind =
  | 'google_business'
  | 'google_analytics'
  | 'linkedin_company_pages';

export type MarketingPresenceProperty = {
  id: string;
  entity_id: string;
  kind: MarketingPresenceKind;
  display_name: string;
  external_id: string | null;
  property_url: string | null;
  status: PartnerConnectionStatus;
  config_meta: Record<string, unknown>;
  last_imported_at: string | null;
  updated_at: string;
};

export type PartnerBiInsight = {
  partner_key: PartnerKey | 'cross_cutting';
  title: string;
  severity: 'info' | 'watch' | 'action';
  detail: string;
  href?: string;
};
