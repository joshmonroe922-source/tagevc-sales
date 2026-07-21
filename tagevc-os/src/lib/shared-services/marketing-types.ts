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
  'tiktok',
  'web',
  'other',
] as const;

export type MarketingPlatform = (typeof MARKETING_PLATFORMS)[number];

export const MARKETING_CAMPAIGN_CHANNELS = ['organic', 'paid'] as const;
export type MarketingCampaignChannel =
  (typeof MARKETING_CAMPAIGN_CHANNELS)[number];

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
  /** organic (default) or paid media stub */
  channel: MarketingCampaignChannel;
  budget_k: number | null;
  /** Revenue attributed to this campaign, in thousands, for ROI reporting. */
  attributed_revenue_k: number | null;
  ad_platform: string | null;
  external_campaign_id: string | null;
  ad_account_id: string | null;
  conversion_metric: string | null;
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
  approval_due_at: string | null;
  approval_ticket_id: string | null;
  approval_assignee: string | null;
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
  account_type: 'publisher' | 'paid_ads';
  currency: string | null;
  timezone: string | null;
  capabilities: Record<string, unknown>;
  verified_at: string | null;
  scope_status: 'unknown' | 'healthy' | 'missing' | 'error';
  scope_checked_at: string | null;
  scope_error: string | null;
  paid_metrics_status: 'unknown' | 'backfilling' | 'healthy' | 'degraded' | 'error';
  paid_metrics_data_through: string | null;
  paid_metrics_last_complete_at: string | null;
  paid_metrics_error: string | null;
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
  'MARKETING_TOKEN_SECRET',
  'MARKETING_APPROVAL_SLA_HOURS',
  'MARKETING_SLA_DIGEST_TO',
  'LINKEDIN_CLIENT_ID',
  'LINKEDIN_MARKETING_API',
  'LINKEDIN_ADS_API',
  'LINKEDIN_ADS_ACCESS_TOKEN',
  'LINKEDIN_API_VERSION',
  'META_API_VERSION',
  'LINKEDIN_ORG_URN',
  'X_CLIENT_ID',
  'META_APP_ID',
  'GOOGLE_OAUTH_CLIENT_ID',
  'YOUTUBE_ANALYTICS',
  'YOUTUBE_CHANNEL_ID',
  'TIKTOK_ANALYTICS',
  'TIKTOK_CLIENT_KEY',
  'TIKTOK_CLIENT_SECRET',
  'TIKTOK_PUBLISH_DIRECT',
  'TIKTOK_DEFAULT_IMAGE_URL',
  'TIKTOK_DEFAULT_VIDEO_URL',
  'MARKETING_SLA_ASSIGNEE',
  'MARKETING_SLA_EMAIL_ASSIGNEES',
  'MARKETING_PAID_ADS_LIVE',
  'MARKETING_ALLOW_STUB_OAUTH',
] as const;
