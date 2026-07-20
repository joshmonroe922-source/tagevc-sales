/**
 * Multichannel Marketing repo (Phase 22 foundation).
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  generateMarketingContent,
  getConfiguredAiProviderId,
} from '@/lib/shared-services/marketing-ai';
import { canStoreOAuthTokens } from '@/lib/shared-services/marketing-crypto';
import { oauthPlatformStatus } from '@/lib/shared-services/marketing-oauth';
import {
  isMarketingSchedulerEnabled,
  validateScheduleInput,
} from '@/lib/shared-services/marketing-scheduler';
import type {
  MarketingCampaign,
  MarketingCampaignStatus,
  MarketingContent,
  MarketingContentKind,
  MarketingContentStatus,
  MarketingGenerationJob,
  MarketingPlatform,
  MarketingScheduleJob,
  MarketingSocialAccount,
} from '@/lib/shared-services/marketing-types';

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4)}`;
}

function asPlatforms(raw: unknown): MarketingPlatform[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is MarketingPlatform => typeof p === 'string');
}

function mapCampaign(row: Record<string, unknown>): MarketingCampaign {
  return {
    campaign_id: String(row.campaign_id),
    name: String(row.name),
    status: row.status as MarketingCampaignStatus,
    entity_id: (row.entity_id as string) ?? null,
    objective: (row.objective as string) ?? null,
    target_platforms: asPlatforms(row.target_platforms),
    starts_at: (row.starts_at as string) ?? null,
    ends_at: (row.ends_at as string) ?? null,
    notes: (row.notes as string) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapContent(row: Record<string, unknown>): MarketingContent {
  return {
    content_id: String(row.content_id),
    campaign_id: (row.campaign_id as string) ?? null,
    entity_id: (row.entity_id as string) ?? null,
    kind: row.kind as MarketingContentKind,
    platform: (row.platform as MarketingPlatform) ?? null,
    title: String(row.title),
    body: (row.body as string) ?? null,
    status: row.status as MarketingContentStatus,
    ai_generated: Boolean(row.ai_generated),
    generation_meta:
      (row.generation_meta as Record<string, unknown>) ?? null,
    scheduled_at: (row.scheduled_at as string) ?? null,
    published_at: (row.published_at as string) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapAccount(row: Record<string, unknown>): MarketingSocialAccount {
  return {
    account_id: String(row.account_id),
    entity_id: (row.entity_id as string) ?? null,
    platform: row.platform as MarketingPlatform,
    handle: String(row.handle),
    display_name: (row.display_name as string) ?? null,
    status: row.status as MarketingSocialAccount['status'],
    external_account_id: (row.external_account_id as string) ?? null,
    last_synced_at: (row.last_synced_at as string) ?? null,
    notes: (row.notes as string) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapSchedule(row: Record<string, unknown>): MarketingScheduleJob {
  return {
    job_id: String(row.job_id),
    content_id: String(row.content_id),
    account_id: (row.account_id as string) ?? null,
    entity_id: (row.entity_id as string) ?? null,
    status: row.status as MarketingScheduleJob['status'],
    scheduled_for: String(row.scheduled_for),
    attempts: Number(row.attempts ?? 0),
    last_error: (row.last_error as string) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapGen(row: Record<string, unknown>): MarketingGenerationJob {
  const ids = row.result_content_ids;
  return {
    job_id: String(row.job_id),
    entity_id: (row.entity_id as string) ?? null,
    campaign_id: (row.campaign_id as string) ?? null,
    kind: row.kind as MarketingGenerationJob['kind'],
    prompt: String(row.prompt),
    status: row.status as MarketingGenerationJob['status'],
    result_content_ids: Array.isArray(ids)
      ? ids.map(String)
      : [],
    error: (row.error as string) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function listCampaigns(limit = 50): Promise<{
  rows: MarketingCampaign[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_marketing_campaigns')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => mapCampaign(r as Record<string, unknown>)),
    };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'list failed' };
  }
}

export async function listContent(limit = 50): Promise<{
  rows: MarketingContent[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_marketing_content')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => mapContent(r as Record<string, unknown>)),
    };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'list failed' };
  }
}

export async function listSocialAccounts(limit = 50): Promise<{
  rows: MarketingSocialAccount[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_marketing_social_accounts')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => mapAccount(r as Record<string, unknown>)),
    };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'list failed' };
  }
}

export async function listScheduleJobs(limit = 30): Promise<{
  rows: MarketingScheduleJob[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_marketing_schedule_jobs')
      .select('*')
      .order('scheduled_for', { ascending: true })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => mapSchedule(r as Record<string, unknown>)),
    };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'list failed' };
  }
}

export async function listGenerationJobs(limit = 20): Promise<{
  rows: MarketingGenerationJob[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_marketing_generation_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => mapGen(r as Record<string, unknown>)),
    };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'list failed' };
  }
}

export async function createCampaign(input: {
  name: string;
  entity_id?: string | null;
  objective?: string | null;
  target_platforms?: MarketingPlatform[];
  notes?: string | null;
}): Promise<{ ok: true; campaign: MarketingCampaign } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    const campaign_id = id('CMP');
    const { data, error } = await sb
      .from('os_marketing_campaigns')
      .insert({
        campaign_id,
        name: input.name.trim(),
        status: 'draft',
        entity_id: input.entity_id || null,
        objective: input.objective || null,
        target_platforms: input.target_platforms ?? [],
        notes: input.notes || null,
        updated_at: now,
      })
      .select('*')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, campaign: mapCampaign(data as Record<string, unknown>) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'create failed' };
  }
}

export async function createContent(input: {
  title: string;
  kind: MarketingContentKind;
  body?: string | null;
  campaign_id?: string | null;
  entity_id?: string | null;
  platform?: MarketingPlatform | null;
}): Promise<{ ok: true; content: MarketingContent } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    const content_id = id('MCT');
    const { data, error } = await sb
      .from('os_marketing_content')
      .insert({
        content_id,
        title: input.title.trim(),
        kind: input.kind,
        body: input.body || null,
        campaign_id: input.campaign_id || null,
        entity_id: input.entity_id || null,
        platform: input.platform || null,
        status: 'draft',
        ai_generated: false,
        updated_at: now,
      })
      .select('*')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, content: mapContent(data as Record<string, unknown>) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'create failed' };
  }
}

export async function registerSocialAccount(input: {
  platform: MarketingPlatform;
  handle: string;
  display_name?: string | null;
  entity_id?: string | null;
  notes?: string | null;
}): Promise<
  { ok: true; account: MarketingSocialAccount } | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    const account_id = id('MSA');
    const { data, error } = await sb
      .from('os_marketing_social_accounts')
      .insert({
        account_id,
        platform: input.platform,
        handle: input.handle.trim().replace(/^@/, ''),
        display_name: input.display_name || null,
        entity_id: input.entity_id || null,
        status: 'pending',
        notes: input.notes || null,
        updated_at: now,
      })
      .select('*')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, account: mapAccount(data as Record<string, unknown>) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'create failed' };
  }
}

export async function enqueueScheduleJob(input: {
  content_id: string;
  account_id?: string | null;
  entity_id?: string | null;
  scheduled_for: string;
}): Promise<
  { ok: true; job: MarketingScheduleJob } | { ok: false; error: string }
> {
  const valid = validateScheduleInput(input);
  if (!valid.ok) return valid;

  if (!isMarketingSchedulerEnabled()) {
    // Still persist as pending — foundation for Phase 23 workers
  }

  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    const job_id = id('MSJ');
    const { data, error } = await sb
      .from('os_marketing_schedule_jobs')
      .insert({
        job_id,
        content_id: input.content_id,
        account_id: input.account_id || null,
        entity_id: input.entity_id || null,
        status: 'pending',
        scheduled_for: input.scheduled_for,
        attempts: 0,
        updated_at: now,
      })
      .select('*')
      .single();
    if (error) return { ok: false, error: error.message };

    await sb
      .from('os_marketing_content')
      .update({
        status: 'scheduled',
        scheduled_at: input.scheduled_for,
        updated_at: now,
      })
      .eq('content_id', input.content_id);

    return { ok: true, job: mapSchedule(data as Record<string, unknown>) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'enqueue failed' };
  }
}

/**
 * Generate content via configured AI provider (OpenAI or stub) + brand voice.
 */
export async function runContentGeneration(input: {
  prompt: string;
  kind: 'blog' | 'social' | 'both';
  entity_id?: string | null;
  campaign_id?: string | null;
  platform?: MarketingPlatform | null;
}): Promise<
  | { ok: true; job: MarketingGenerationJob; content_ids: string[] }
  | { ok: false; error: string }
> {
  if (!input.prompt.trim()) {
    return { ok: false, error: 'prompt required' };
  }

  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    const job_id = id('MGJ');
    const contentKinds =
      input.kind === 'both'
        ? (['blog', 'social'] as const)
        : ([input.kind] as const);

    const contentIds: string[] = [];
    for (const kind of contentKinds) {
      const gen = await generateMarketingContent({
        kind,
        platform: input.platform ?? (kind === 'blog' ? 'web' : 'linkedin'),
        entity_id: input.entity_id,
        campaign_id: input.campaign_id,
        prompt: input.prompt,
      });
      if (!gen.ok) {
        return { ok: false, error: gen.error ?? 'generation failed' };
      }
      const content_id = id('MCT');
      const { error } = await sb.from('os_marketing_content').insert({
        content_id,
        title: gen.title ?? `Generated ${kind}`,
        kind,
        body: gen.body ?? null,
        campaign_id: input.campaign_id || null,
        entity_id: input.entity_id || null,
        platform: input.platform ?? (kind === 'blog' ? 'web' : 'linkedin'),
        status: 'draft',
        ai_generated: true,
        generation_meta: gen.meta ?? { provider: gen.provider },
        updated_at: now,
      });
      if (error) return { ok: false, error: error.message };
      contentIds.push(content_id);
    }

    const { data, error } = await sb
      .from('os_marketing_generation_jobs')
      .insert({
        job_id,
        entity_id: input.entity_id || null,
        campaign_id: input.campaign_id || null,
        kind: input.kind,
        prompt: input.prompt.trim(),
        status: 'succeeded',
        result_content_ids: contentIds,
        updated_at: now,
      })
      .select('*')
      .single();
    if (error) return { ok: false, error: error.message };

    return {
      ok: true,
      job: mapGen(data as Record<string, unknown>),
      content_ids: contentIds,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'generation failed',
    };
  }
}

/** @deprecated use runContentGeneration */
export const runStubGeneration = runContentGeneration;

export async function approveContent(
  contentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    const { error } = await sb
      .from('os_marketing_content')
      .update({ status: 'approved', updated_at: now })
      .eq('content_id', contentId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'approve failed' };
  }
}

export function getMarketingFoundationStatus() {
  const platforms = oauthPlatformStatus();
  return {
    ai_provider: getConfiguredAiProviderId(),
    scheduler_enabled: isMarketingSchedulerEnabled(),
    oauth_tokens_stored: canStoreOAuthTokens(),
    linkedin_oauth: platforms.linkedin.configured,
    x_oauth: platforms.x.configured,
    facebook_oauth: platforms.facebook.configured,
    instagram_oauth: platforms.instagram.configured,
    youtube_oauth: platforms.youtube.configured,
    phase: 26,
  };
}
