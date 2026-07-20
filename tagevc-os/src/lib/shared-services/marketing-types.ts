/**
 * Multichannel Marketing System — domain types (Phase 22 foundation).
 * Full AI generation + auto-posting deferred to Phase 23+.
 */

export const MARKETING_PLATFORMS = [
  'linkedin',
  'x',
  'instagram',
  'facebook',
  'youtube',
  'web',
  'other',
] as const;

export type MarketingPlatform = (typeof MARKETING_PLATFORMS)[number];

export const MARKETING_CONTENT_KINDS = [
  'blog',
  'social',
  'email',
  'landing',
  'other',
] as const;

export type MarketingContentKind = (typeof MARKETING_CONTENT_KINDS)[number];

export const MARKETING_CAMPAIGN_STATUSES = [
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
] as const;

export type MarketingCampaignStatus =
  (typeof MARKETING_CAMPAIGN_STATUSES)[number];

export const MARKETING_CONTENT_STATUSES = [
  'draft',
  'review',
  'approved',
  'scheduled',
  'published',
  'failed',
] as const;

export type MarketingContentStatus =
  (typeof MARKETING_CONTENT_STATUSES)[number];

export const MARKETING_ACCOUNT_STATUSES = [
  'pending',
  'connected',
  'disconnected',
  'error',
] as const;

export type MarketingAccountStatus =
  (typeof MARKETING_ACCOUNT_STATUSES)[number];

export const MARKETING_JOB_STATUSES = [
  'pending',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export type MarketingJobStatus = (typeof MARKETING_JOB_STATUSES)[number];

/** Firm-wide when entity_id is null; subsidiary/portfolio when set. */
export type MarketingCampaign = {
  campaign_id: string;
  name: string;
  status: MarketingCampaignStatus;
  entity_id: string | null;
  objective: string | null;
  target_platforms: MarketingPlatform[];
  starts_at: string | null;
  ends_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingContent = {
  content_id: string;
  campaign_id: string | null;
  entity_id: string | null;
  kind: MarketingContentKind;
  platform: MarketingPlatform | null;
  title: string;
  body: string | null;
  status: MarketingContentStatus;
  ai_generated: boolean;
  generation_meta: Record<string, unknown> | null;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Social account connection record.
 * OAuth tokens are NOT stored in Phase 22 — only connection metadata.
 */
export type MarketingSocialAccount = {
  account_id: string;
  entity_id: string | null;
  platform: MarketingPlatform;
  handle: string;
  display_name: string | null;
  status: MarketingAccountStatus;
  external_account_id: string | null;
  last_synced_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingScheduleJob = {
  job_id: string;
  content_id: string;
  account_id: string | null;
  entity_id: string | null;
  status: MarketingJobStatus;
  scheduled_for: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingGenerationJob = {
  job_id: string;
  entity_id: string | null;
  campaign_id: string | null;
  kind: 'blog' | 'social' | 'both';
  prompt: string;
  status: MarketingJobStatus;
  result_content_ids: string[];
  error: string | null;
  created_at: string;
  updated_at: string;
};

export const MARKETING_ENV_KEYS = [
  'MARKETING_AI_PROVIDER',
  'MARKETING_SCHEDULER_ENABLED',
] as const;
