/** Shared graph types (packages/db adaptation). */

export type OrgKind = 'parent' | 'subsidiary';
export type EnrichStatus = 'pending' | 'running' | 'enriched' | 'failed' | 'stale';
export type EmailVerifyStatus =
  | 'unknown'
  | 'valid'
  | 'invalid'
  | 'catch_all'
  | 'risky';
export type OrgEdgeStatus = 'suggested' | 'confirmed' | 'rejected';
export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'budget_blocked'
  | 'cancelled';

export type SpineOrganization = {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
  kind: OrgKind;
  feature_flags: Record<string, unknown>;
  icp_title_patterns: string[];
  auto_expand_employees: boolean;
  auto_expand_cap: number;
  auto_expand_peers: boolean;
  monthly_enrichment_budget_usd: number;
};

export type SpineAccount = {
  id: string;
  canonical_domain: string | null;
  name: string;
  legal_name: string | null;
  website: string | null;
  industry: string | null;
  enrich_status: EnrichStatus | string;
  apollo_org_id: string | null;
};

export type SpineContact = {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  primary_email: string | null;
  primary_email_status: EmailVerifyStatus | string;
  title: string | null;
  linkedin_url: string | null;
  enrich_status: EnrichStatus | string;
};

export type MergeSource =
  | 'user'
  | 'apollo'
  | 'pdl'
  | 'hunter'
  | 'zerobounce'
  | 'website'
  | 'import'
  | 'agent';

export type MergeFieldInput = {
  field: string;
  value: string | null | undefined;
  source: MergeSource;
  confidence?: number;
  locked?: boolean;
  existingValue?: string | null;
  existingSource?: MergeSource | string | null;
  existingLocked?: boolean;
  emailStatus?: EmailVerifyStatus | string | null;
  allowCatchAll?: boolean;
};
