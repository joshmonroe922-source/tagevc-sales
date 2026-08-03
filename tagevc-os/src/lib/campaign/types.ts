/**
 * Email Campaign Center — shared types (CRM-first, entity-scoped).
 * Dual-plane: Graph (1:1/bulk controlled) + Owned MTA (future Postal).
 */

export const ECC_SERVICE_KEY = 'marketing.email_campaign_center' as const;
export const ECC_ROUTE_PREFIX =
  '/shared-services/marketing/email-campaign-center' as const;

export type DeliveryPlane = 'graph' | 'owned_mta' | 'auto';
export type EmailPermission = 'opted_in' | 'opted_out' | 'unknown';
export type CampaignStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'paused'
  | 'cancelled'
  | 'failed';
export type CampaignType = 'blast' | 'ab' | 'recurring' | 'sequence';
export type JourneyType = 'journey' | 'sequence' | 'transactional_drip';
export type EnrollmentState =
  | 'active'
  | 'paused'
  | 'exited'
  | 'completed'
  | 'blocked';

export type AudienceRef =
  | { type: 'list'; id: string }
  | { type: 'segment'; id: string }
  | { type: 'contacts'; contactIds: string[] };

export type CampaignRow = {
  id: string;
  entity_id: string;
  name: string;
  campaign_type: CampaignType;
  status: CampaignStatus;
  audience_type: 'list' | 'segment' | 'contacts' | null;
  audience_id: string | null;
  template_id: string | null;
  identity_id: string | null;
  subject: string;
  preheader: string | null;
  body_html: string;
  schedule_at: string | null;
  timezone: string;
  delivery_plane: DeliveryPlane;
  created_by: string | null;
  owner_id: string | null;
  sent_at: string | null;
  stats_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type TemplateRow = {
  id: string;
  entity_id: string;
  name: string;
  category: string;
  subject: string;
  preheader: string | null;
  html: string;
  mjml: string | null;
  status: string;
  include_signature_default: boolean;
};

export type ListRow = {
  id: string;
  entity_id: string;
  name: string;
  list_type: string;
  description: string | null;
  count_cached: number;
};

export type SegmentDefinition = {
  op: 'and' | 'or';
  rules: SegmentRule[];
};

export type SegmentRule =
  | {
      field: string;
      operator: 'eq' | 'neq' | 'contains' | 'in' | 'gt' | 'lt' | 'exists';
      value?: string | number | string[] | boolean | null;
    }
  | { op: 'and' | 'or'; rules: SegmentRule[] };

export type MergeField = {
  object: string;
  api_name: string;
  label: string;
  data_type: string;
  group?: string;
  insert_token: string;
  sensitive: boolean;
  sample_value?: string | null;
};

export type ConsentGateResult =
  | { allow: true }
  | { allow: false; reason: string };

export type MutexConflict =
  | { ok: true }
  | {
      ok: false;
      code: 'CONFLICT';
      blockingEnrollmentIds: string[];
      message: string;
    };

export type EccHomePayload = {
  dueNow: Array<{
    enrollmentId: string;
    contactName: string;
    stepLabel: string;
    dueAt: string | null;
  }>;
  hotFollowUps: Array<{
    contactId: string;
    contactName: string;
    email: string | null;
    score: number;
    reason: string;
  }>;
  needsApproval: Array<{ id: string; name: string; status: string }>;
  deliverabilityAlerts: Array<{ kind: string; message: string }>;
  teamPulse: {
    sends: number;
    replies: number;
    stuckSteps: number;
  } | null;
  stats: {
    campaigns: number;
    lists: number;
    templates: number;
    suppressed: number;
  };
};

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'DOMAIN_NOT_VERIFIED'
  | 'CONSENT_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'RATE_LIMITED'
  | 'KILL_SWITCH'
  | 'CONFLICT'
  | 'DISABLED';

export function apiError(
  code: ApiErrorCode,
  message: string,
  details: Record<string, unknown> = {},
) {
  return { error: { code, message, details } };
}
