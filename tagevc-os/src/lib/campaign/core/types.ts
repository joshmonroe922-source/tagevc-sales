/** Tage Email Campaign Center — shared types (spine key marketing.email_campaign_center). */

export const ECC_SERVICE_KEY = 'marketing.email_campaign_center' as const;
export const ECC_ROUTE_PREFIX = '/shared-services/marketing/email-campaign-center';

export type DeliveryPlane = 'graph' | 'owned_mta' | 'controlled_graph' | 'auto';
export type EmailPermission = 'opted_in' | 'opted_out' | 'unknown';
export type CampaignStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'paused'
  | 'cancelled';
export type CampaignType = 'blast' | 'ab' | 'recurring' | 'sequence' | 'journey';
export type ConsentStatus = 'opt_in' | 'opt_out' | 'pending';
export type SuppressionReason =
  | 'bounce_hard'
  | 'complaint'
  | 'unsub'
  | 'manual'
  | 'legal'
  | 'soft_bounce_threshold';

export type SegmentRule = {
  field: string;
  op?: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'in' | 'exists';
  /** Alias used in tests and legacy DSL */
  operator?: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'in' | 'exists';
  value?: unknown;
};

export type SegmentDefinition = {
  op: 'and' | 'or';
  rules: Array<SegmentRule | SegmentDefinition>;
};

export type MergeField = {
  object: string;
  api_name: string;
  label: string;
  data_type: string;
  sensitive: boolean;
  insert_token: string;
  sample_value?: string;
};

export type ConsentGateResult =
  | { allow: true }
  | { allow: false; reason: string; code: string };

export type MutexConflict = {
  code: 'CONFLICT';
  blockingEnrollmentIds: string[];
  message: string;
};

export const PERMISSIONED_LIFECYCLES = new Set([
  'Target',
  'Active - Buying',
  'Active',
  'Inactive',
  'target',
  'active_buying',
  'active',
  'inactive',
]);
