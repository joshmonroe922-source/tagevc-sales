'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  approveContent,
  createCampaign,
  createContent,
  enqueueScheduleJob,
  listCampaigns,
  listContent,
  listSocialAccounts,
  registerSocialAccount,
  runContentGeneration,
} from '@/lib/shared-services/marketing-repo';
import { upsertBrandVoice } from '@/lib/shared-services/marketing-brand';
import { processDueScheduleJobs } from '@/lib/shared-services/marketing-scheduler';
import { MARKETING_CONTENT_KINDS, MARKETING_PLATFORMS } from '@/lib/shared-services/marketing-types';
import { guardPermission } from '@/lib/rbac/session';
import {
  canAccessEntityId,
  entityScopeDeniedMessage,
} from '@/lib/rbac/entity-scope';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { recordPaidRevenueEvidence } from '@/lib/shared-services/marketing-attribution';
import {
  bindMarketingRevenueCampaign,
  reviewMarketingRevenueCorrection,
  upsertMarketingRevenueSource,
} from '@/lib/shared-services/marketing-phase41';
import { proposeResolveAttributionConflict } from '@/lib/shared-services/marketing-phase44';
import {
  approveMarketingDryRunPromotePhase50,
  proposeMarketingDryRunPromotePhase50,
} from '@/lib/shared-services/marketing-phase50';
import {
  REVENUE_AUTHENTICITY_MODES,
  REVENUE_LEDGER_KINDS,
  REVENUE_LEDGER_PROFILES,
} from '@/lib/shared-services/marketing-revenue-contracts';

export type MarketingActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

function revalidateMarketing() {
  revalidatePath('/shared-services/marketing');
  revalidatePath('/shared-services');
}

export async function createCampaignAction(
  _prev: MarketingActionResult | null,
  formData: FormData,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;

  const parsed = z
    .object({
      name: z.string().min(2),
      entity_id: z.string().optional(),
      objective: z.string().optional(),
      notes: z.string().optional(),
      channel: z.enum(['organic', 'paid']).optional(),
      budget_k: z.string().optional(),
      attributed_revenue_k: z.string().optional(),
      ad_platform: z.enum(['linkedin_ads', 'meta_ads']).optional(),
      external_campaign_id: z.string().optional(),
      ad_account_id: z.string().optional(),
      conversion_metric: z.string().max(120).optional(),
    })
    .safeParse({
      name: formData.get('name'),
      entity_id: formData.get('entity_id') || undefined,
      objective: formData.get('objective') || undefined,
      notes: formData.get('notes') || undefined,
      channel: formData.get('channel') || undefined,
      budget_k: formData.get('budget_k') || undefined,
      attributed_revenue_k:
        formData.get('attributed_revenue_k') || undefined,
      ad_platform: formData.get('ad_platform') || undefined,
      external_campaign_id: formData.get('external_campaign_id') || undefined,
      ad_account_id: formData.get('ad_account_id') || undefined,
      conversion_metric: formData.get('conversion_metric') || undefined,
    });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      parsed.data.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(parsed.data.entity_id || 'firm-wide'),
    };
  }

  const budgetRaw = parsed.data.budget_k?.trim();
  const budget_k =
    budgetRaw && !Number.isNaN(Number(budgetRaw)) ? Number(budgetRaw) : null;
  const revenueRaw = parsed.data.attributed_revenue_k?.trim();
  const attributed_revenue_k =
    revenueRaw && !Number.isNaN(Number(revenueRaw))
      ? Number(revenueRaw)
      : null;
  if (budget_k != null && budget_k < 0) {
    return { ok: false, error: 'Budget cannot be negative' };
  }
  if (attributed_revenue_k != null && attributed_revenue_k < 0) {
    return { ok: false, error: 'Attributed revenue cannot be negative' };
  }
  if (
    parsed.data.channel === 'paid' &&
    (!parsed.data.ad_platform?.trim() ||
      !parsed.data.external_campaign_id?.trim() ||
      !parsed.data.ad_account_id?.trim())
  ) {
    return {
      ok: false,
      error:
        'Paid campaigns require ad platform, connected ad account, and external campaign ID',
    };
  }
  if (parsed.data.channel === 'paid') {
    const accounts = await listSocialAccounts(200);
    const adAccount = accounts.rows.find(
      (account) => account.account_id === parsed.data.ad_account_id,
    );
    const expectedPlatform =
      parsed.data.ad_platform === 'linkedin_ads' ? 'linkedin' : 'facebook';
    if (
      !adAccount ||
      adAccount.account_type !== 'paid_ads' ||
      adAccount.status !== 'connected' ||
      adAccount.entity_id !== (parsed.data.entity_id || null) ||
      adAccount.platform !== expectedPlatform
    ) {
      return {
        ok: false,
        error:
          'Ad account must be connected, provider-compatible, and scoped to the campaign entity',
      };
    }
  }

  const res = await createCampaign({
    name: parsed.data.name,
    entity_id: parsed.data.entity_id || null,
    objective: parsed.data.objective || null,
    notes: parsed.data.notes || null,
    channel: parsed.data.channel === 'paid' ? 'paid' : 'organic',
    budget_k,
    attributed_revenue_k,
    ad_platform: parsed.data.ad_platform || null,
    external_campaign_id: parsed.data.external_campaign_id || null,
    ad_account_id: parsed.data.ad_account_id || null,
    conversion_metric: parsed.data.conversion_metric || null,
  });
  if (!res.ok) return res;
  revalidateMarketing();
  return { ok: true, message: `Created ${res.campaign.campaign_id}` };
}

export async function createContentAction(
  _prev: MarketingActionResult | null,
  formData: FormData,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;

  const parsed = z
    .object({
      title: z.string().min(2),
      kind: z.enum(MARKETING_CONTENT_KINDS),
      body: z.string().optional(),
      campaign_id: z.string().optional(),
      entity_id: z.string().optional(),
      platform: z.enum(MARKETING_PLATFORMS).optional(),
      media_url: z.string().url().optional(),
    })
    .safeParse({
      title: formData.get('title'),
      kind: formData.get('kind'),
      body: formData.get('body') || undefined,
      campaign_id: formData.get('campaign_id') || undefined,
      entity_id: formData.get('entity_id') || undefined,
      platform: formData.get('platform') || undefined,
      media_url: formData.get('media_url') || undefined,
    });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }
  let contentEntity = parsed.data.entity_id || null;
  if (parsed.data.campaign_id) {
    const campaigns = await listCampaigns(200);
    const campaign = campaigns.rows.find(
      (c) => c.campaign_id === parsed.data.campaign_id,
    );
    if (!campaign) return { ok: false, error: 'Campaign not found' };
    if (contentEntity && contentEntity !== campaign.entity_id) {
      return {
        ok: false,
        error: 'Content entity must match the campaign entity',
      };
    }
    contentEntity = campaign.entity_id;
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      contentEntity,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(contentEntity || 'firm-wide'),
    };
  }

  const res = await createContent({
    title: parsed.data.title,
    kind: parsed.data.kind,
    body: parsed.data.body || null,
    campaign_id: parsed.data.campaign_id || null,
    entity_id: contentEntity,
    platform: parsed.data.platform || null,
    media_url: parsed.data.media_url || null,
  });
  if (!res.ok) return res;
  revalidateMarketing();
  return { ok: true, message: `Created ${res.content.content_id}` };
}

export async function registerAccountAction(
  _prev: MarketingActionResult | null,
  formData: FormData,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;

  const parsed = z
    .object({
      platform: z.enum(MARKETING_PLATFORMS),
      handle: z.string().min(1),
      display_name: z.string().optional(),
      entity_id: z.string().optional(),
      notes: z.string().optional(),
      account_type: z.enum(['publisher', 'paid_ads']).optional(),
      external_account_id: z.string().optional(),
    })
    .safeParse({
      platform: formData.get('platform'),
      handle: formData.get('handle'),
      display_name: formData.get('display_name') || undefined,
      entity_id: formData.get('entity_id') || undefined,
      notes: formData.get('notes') || undefined,
      account_type: formData.get('account_type') || undefined,
      external_account_id: formData.get('external_account_id') || undefined,
    });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }
  if (
    parsed.data.account_type === 'paid_ads' &&
    !['linkedin', 'facebook'].includes(parsed.data.platform)
  ) {
    return {
      ok: false,
      error:
        'Paid ad connections currently require LinkedIn or Facebook',
    };
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      parsed.data.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(parsed.data.entity_id || 'firm-wide'),
    };
  }

  const res = await registerSocialAccount({
    platform: parsed.data.platform,
    handle: parsed.data.handle,
    display_name: parsed.data.display_name || null,
    entity_id: parsed.data.entity_id || null,
    notes: parsed.data.notes || null,
    account_type: parsed.data.account_type ?? 'publisher',
    external_account_id: parsed.data.external_account_id || null,
  });
  if (!res.ok) return res;
  revalidateMarketing();
  return {
    ok: true,
    message: `Registered ${res.account.account_id} (pending OAuth — Phase 23+)`,
  };
}

export async function scheduleContentAction(
  contentId: string,
  scheduledFor: string,
  accountId?: string,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const [contentRows, accountRows] = await Promise.all([
    listContent(200),
    listSocialAccounts(200),
  ]);
  const content = contentRows.rows.find((row) => row.content_id === contentId);
  if (!content) return { ok: false, error: 'Content not found' };
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      content.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(content.entity_id || 'firm-wide'),
    };
  }
  const account = accountId
    ? accountRows.rows.find((row) => row.account_id === accountId)
    : null;
  if (accountId && !account) {
    return { ok: false, error: 'Social account not found' };
  }
  if (
    account &&
    (account.entity_id !== content.entity_id ||
      (content.platform && account.platform !== content.platform))
  ) {
    return {
      ok: false,
      error: 'Account platform and entity must match the content',
    };
  }

  const res = await enqueueScheduleJob({
    content_id: contentId,
    scheduled_for: scheduledFor,
    account_id: accountId || null,
    entity_id: content.entity_id,
  });
  if (!res.ok) return res;
  revalidateMarketing();
  return { ok: true, message: `Queued ${res.job.job_id}` };
}

export async function generateDraftAction(
  _prev: MarketingActionResult | null,
  formData: FormData,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;

  const parsed = z
    .object({
      prompt: z.string().min(8),
      kind: z.enum(['blog', 'social', 'both']),
      entity_id: z.string().optional(),
      campaign_id: z.string().optional(),
    })
    .safeParse({
      prompt: formData.get('prompt'),
      kind: formData.get('kind') || 'social',
      entity_id: formData.get('entity_id') || undefined,
      campaign_id: formData.get('campaign_id') || undefined,
    });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const res = await runContentGeneration({
    prompt: parsed.data.prompt,
    kind: parsed.data.kind,
    entity_id: parsed.data.entity_id || null,
    campaign_id: parsed.data.campaign_id || null,
  });
  if (!res.ok) return res;
  revalidateMarketing();
  return {
    ok: true,
    message: `Generated → ${res.content_ids.join(', ')} (${res.job.job_id})`,
  };
}

export async function upsertBrandVoiceAction(
  _prev: MarketingActionResult | null,
  formData: FormData,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;

  const parsed = z
    .object({
      name: z.string().min(2),
      entity_id: z.string().optional(),
      tone_guidelines: z.string().optional(),
      audience: z.string().optional(),
      preferred_phrases: z.string().optional(),
      forbidden_phrases: z.string().optional(),
    })
    .safeParse({
      name: formData.get('name'),
      entity_id: formData.get('entity_id') || undefined,
      tone_guidelines: formData.get('tone_guidelines') || undefined,
      audience: formData.get('audience') || undefined,
      preferred_phrases: formData.get('preferred_phrases') || undefined,
      forbidden_phrases: formData.get('forbidden_phrases') || undefined,
    });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const split = (s?: string) =>
    (s ?? '')
      .split(/[,;\n]/)
      .map((x) => x.trim())
      .filter(Boolean);

  const res = await upsertBrandVoice({
    name: parsed.data.name,
    entity_id: parsed.data.entity_id || null,
    tone_guidelines: parsed.data.tone_guidelines || null,
    audience: parsed.data.audience || null,
    preferred_phrases: split(parsed.data.preferred_phrases),
    forbidden_phrases: split(parsed.data.forbidden_phrases),
  });
  if (!res.ok) return res;
  revalidateMarketing();
  return { ok: true, message: `Brand voice ${res.voice.voice_id} saved` };
}

export async function approveContentAction(
  contentId: string,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const res = await approveContent(contentId);
  if (!res.ok) return res;
  revalidateMarketing();
  return { ok: true, message: `Approved ${contentId}` };
}

export async function submitForReviewAction(
  contentId: string,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const { submitContentForReview } = await import(
    '@/lib/shared-services/marketing-repo'
  );
  const res = await submitContentForReview(contentId);
  if (!res.ok) return res;
  revalidateMarketing();
  return {
    ok: true,
    message: `Submitted for review · due ${res.approval_due_at.slice(0, 16)}${
      res.approval_ticket_id ? ` · ${res.approval_ticket_id}` : ''
    }`,
  };
}

export async function stubConnectAccountAction(
  accountId: string,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  if (
    process.env.MARKETING_ALLOW_STUB_OAUTH !== '1' &&
    process.env.MARKETING_ALLOW_STUB_OAUTH !== 'true'
  ) {
    return { ok: false, error: 'Stub OAuth is disabled' };
  }
  const { stubConnectAccount } = await import(
    '@/lib/shared-services/marketing-oauth'
  );
  const res = await stubConnectAccount(accountId);
  if (!res.ok) return res;
  revalidateMarketing();
  return { ok: true, message: `Stub-connected ${accountId}` };
}

export async function queuePaidMetricsBackfillAction(
  accountId: string,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const accounts = await listSocialAccounts(200);
  const account = accounts.rows.find(
    (candidate) => candidate.account_id === accountId,
  );
  if (!account || account.account_type !== 'paid_ads') {
    return { ok: false, error: 'Paid ad account not found' };
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      account.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(account.entity_id || 'firm-wide'),
    };
  }
  const { enqueueScheduledPaidWindows } = await import(
    '@/lib/shared-services/marketing-paid-backfill'
  );
  const result = await enqueueScheduledPaidWindows({
    source: 'manual',
    requestedBy: gate.profile.id,
    accountId,
  });
  revalidateMarketing();
  return result.errors.length > 0
    ? { ok: false, error: result.errors.join('; ') }
    : { ok: true, message: `Queued ${result.queued} paid metric window(s)` };
}

export async function retryPaidMetricsRunAction(
  runId: string,
  reason: string,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const parsed = z.object({
    runId: z.string().uuid(),
    reason: z.string().trim().min(15).max(500),
  }).safeParse({ runId, reason });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || 'Invalid retry' };
  }
  const sb = await createPersistClient();
  const { data: run, error: runError } = await sb
    .from('os_marketing_paid_sync_runs')
    .select('entity_id')
    .eq('run_id', parsed.data.runId)
    .single();
  if (runError || !run) {
    return { ok: false, error: runError?.message || 'Paid sync run not found' };
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      run.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(run.entity_id || 'firm-wide'),
    };
  }
  const { error } = await sb.rpc('retry_marketing_paid_sync_run', {
    p_run_id: parsed.data.runId,
    p_actor_id: gate.profile.id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: error.message };
  revalidateMarketing();
  return { ok: true, message: 'Paid sync run queued for governed retry' };
}

export async function recordPaidRevenueEvidenceAction(
  _prev: MarketingActionResult | null,
  formData: FormData,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const parsed = z.object({
    campaign_id: z.string().min(1).max(200),
    revenue_event_id: z.string().min(1).max(200),
    revenue_occurred_at: z.string().datetime({ offset: true }),
    attributed_amount: z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/),
    settled_amount: z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/),
    settlement_status: z.enum(['pending', 'partial', 'settled', 'reversed']),
    expected_settlement_at: z.string().datetime({ offset: true }).nullable(),
    settled_at: z.string().datetime({ offset: true }).nullable(),
    attribution_window_days: z.coerce.number().int().min(1).max(90),
    attribution_model: z.enum([
      'first_touch',
      'last_touch',
      'linear',
      'position_based',
      'provider_reported',
    ]),
    attribution_model_version: z.string().min(1).max(100),
    source_system: z.string().min(1).max(100),
    source_record_id: z.string().min(1).max(200),
    source_recorded_at: z.string().datetime({ offset: true }),
    source_payload_json: z.string().min(2).max(16_384),
    revision: z.coerce.number().int().min(1).max(10_000),
    supersedes_evidence_id: z.string().uuid().nullable(),
  }).safeParse({
    campaign_id: formData.get('campaign_id'),
    revenue_event_id: formData.get('revenue_event_id'),
    revenue_occurred_at: formData.get('revenue_occurred_at'),
    attributed_amount: formData.get('attributed_amount'),
    settled_amount: formData.get('settled_amount') || '0',
    settlement_status: formData.get('settlement_status'),
    expected_settlement_at:
      formData.get('expected_settlement_at') || null,
    settled_at: formData.get('settled_at') || null,
    attribution_window_days: formData.get('attribution_window_days'),
    attribution_model: formData.get('attribution_model'),
    attribution_model_version: formData.get('attribution_model_version'),
    source_system: formData.get('source_system'),
    source_record_id: formData.get('source_record_id'),
    source_recorded_at: formData.get('source_recorded_at'),
    source_payload_json: formData.get('source_payload_json'),
    revision: formData.get('revision') || '1',
    supersedes_evidence_id: formData.get('supersedes_evidence_id') || null,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid revenue evidence',
    };
  }
  const sb = await createPersistClient();
  const { data: campaign, error: campaignError } = await sb
    .from('os_marketing_campaigns')
    .select(
      'campaign_id, entity_id, ad_account_id, ad_platform, external_campaign_id, channel',
    )
    .eq('campaign_id', parsed.data.campaign_id)
    .single();
  if (
    campaignError ||
    !campaign ||
    campaign.channel !== 'paid' ||
    !campaign.entity_id ||
    !campaign.ad_account_id ||
    !campaign.ad_platform ||
    !campaign.external_campaign_id
  ) {
    return { ok: false, error: 'Complete paid campaign binding not found' };
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      campaign.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(campaign.entity_id),
    };
  }
  const { data: account, error: accountError } = await sb
    .from('os_marketing_social_accounts')
    .select('account_id, entity_id, external_account_id, currency')
    .eq('account_id', campaign.ad_account_id)
    .single();
  if (
    accountError ||
    !account ||
    account.entity_id !== campaign.entity_id ||
    !account.external_account_id ||
    !account.currency
  ) {
    return { ok: false, error: 'Paid account binding is incomplete' };
  }
  const idempotencyKey = `phase39:${createHash('sha256')
    .update(
      JSON.stringify([
        campaign.ad_platform,
        account.external_account_id,
        campaign.external_campaign_id,
        parsed.data.source_system,
        parsed.data.source_record_id,
        parsed.data.revenue_event_id,
        parsed.data.revision,
      ]),
    )
    .digest('hex')}`;
  const result = await recordPaidRevenueEvidence(
    {
      ...parsed.data,
      idempotency_key: idempotencyKey,
      entity_id: campaign.entity_id,
      provider: campaign.ad_platform as 'meta_ads' | 'linkedin_ads',
      ad_account_id: account.account_id,
      external_account_id: account.external_account_id,
      external_campaign_id: campaign.external_campaign_id,
      currency: account.currency,
    },
    gate.profile.id,
  );
  if (!result.ok) return result;
  revalidateMarketing();
  return {
    ok: true,
    message: `${result.created ? 'Recorded' : 'Replayed'} revenue evidence ${result.evidenceId}`,
  };
}

export async function runScheduleWorkerAction(): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const result = await processDueScheduleJobs({ force: true, limit: 10 });
  revalidateMarketing();
  if (result.skipped) {
    return { ok: true, message: result.reason ?? 'Skipped' };
  }
  const ok = result.processed.filter((p) => p.ok).length;
  const fail = result.processed.filter((p) => !p.ok).length;
  return {
    ok: true,
    message: `Worker: ${ok} posted, ${fail} failed (${result.processed.length} due)`,
  };
}

export async function recordEngagementAction(
  contentId: string,
  impressions: number,
  clicks: number,
  likes: number,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const { recordEngagement } = await import(
    '@/lib/shared-services/marketing-analytics'
  );
  const res = await recordEngagement({
    content_id: contentId,
    impressions,
    clicks,
    likes,
  });
  if (!res.ok) return res;
  revalidateMarketing();
  return { ok: true, message: `Engagement recorded for ${contentId}` };
}

export async function refreshTokensAction(): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const { refreshExpiringTokens } = await import(
    '@/lib/shared-services/marketing-token-refresh'
  );
  const { results } = await refreshExpiringTokens(20);
  revalidateMarketing();
  const refreshed = results.filter((r) => r.ok && r.refreshed).length;
  const failed = results.filter((r) => !r.ok).length;
  return {
    ok: true,
    message: `Token refresh: ${refreshed} refreshed, ${failed} failed`,
  };
}

export async function pullEngagementAction(): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const { pullLiveEngagement } = await import(
    '@/lib/shared-services/marketing-engagement'
  );
  const { pulled, failed } = await pullLiveEngagement({ limit: 15 });
  revalidateMarketing();
  return {
    ok: true,
    message: `Engagement pull: ${pulled} updated, ${failed} failed`,
  };
}

export async function runApprovalSlaDigestAction(): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const { runApprovalSlaEscalation } = await import(
    '@/lib/shared-services/marketing-sla-digest'
  );
  const res = await runApprovalSlaEscalation({ email: true });
  if (res.error) return { ok: false, error: res.error };
  revalidateMarketing();
  return {
    ok: true,
    message: `SLA digest: ${res.overdue} overdue · notified ${res.notified} · emailed ${res.emailed}`,
  };
}

export async function syncPaidCampaignAction(
  campaignId: string,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const campaigns = await listCampaigns(200);
  const campaign = campaigns.rows.find((c) => c.campaign_id === campaignId);
  if (!campaign) return { ok: false, error: 'Campaign not found' };
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      campaign.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(campaign.entity_id || 'firm-wide'),
    };
  }
  if (!campaign.ad_account_id) {
    return { ok: false, error: 'Campaign is not bound to a paid account' };
  }
  const { enqueueScheduledPaidWindows } = await import(
    '@/lib/shared-services/marketing-paid-backfill'
  );
  const res = await enqueueScheduledPaidWindows({
    source: 'manual',
    requestedBy: gate.profile.id,
    accountId: campaign.ad_account_id,
  });
  if (res.errors.length > 0) {
    return { ok: false, error: res.errors.join('; ') };
  }
  revalidateMarketing();
  return {
    ok: true,
    message: `Queued ${res.queued} governed paid-metrics window(s)`,
  };
}

export async function reviewMarketingRevenueCorrectionAction(
  correctionId: string,
  decision: 'approved' | 'rejected',
  reason: string,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const sb = await createPersistClient();
  const { data: correction, error: correctionError } = await sb
    .from('os_marketing_revenue_corrections')
    .select('correction_id,source_id,status')
    .eq('correction_id', correctionId)
    .maybeSingle();
  if (correctionError || !correction) {
    return {
      ok: false,
      error: correctionError?.message ?? 'Correction not found',
    };
  }
  const { data: source, error: sourceError } = await sb
    .from('os_marketing_revenue_sources')
    .select('entity_id')
    .eq('source_id', correction.source_id)
    .single();
  if (sourceError || !source) {
    return {
      ok: false,
      error: sourceError?.message ?? 'Correction source not found',
    };
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      source.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(source.entity_id),
    };
  }
  const result = await reviewMarketingRevenueCorrection({
    correctionId,
    actorId: gate.profile.id,
    decision,
    reason,
  });
  if (!result.ok) return result;
  revalidateMarketing();
  return {
    ok: true,
    message:
      decision === 'approved'
        ? `Approved correction ${correctionId}`
        : `Rejected correction ${correctionId}`,
  };
}

export async function resolveMarketingAttributionConflictAction(
  conflictId: string,
  resolution: 'proposed' | 'approved' | 'rejected',
  reason: string,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const sb = await createPersistClient();
  const { data: conflict, error: conflictError } = await sb
    .from('os_marketing_revenue_attribution_conflicts')
    .select('conflict_id,entity_id,resolution_status')
    .eq('conflict_id', conflictId)
    .maybeSingle();
  if (conflictError || !conflict) {
    return {
      ok: false,
      error: conflictError?.message ?? 'Attribution conflict not found',
    };
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      conflict.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(conflict.entity_id),
    };
  }
  const result = await proposeResolveAttributionConflict({
    conflictId,
    resolution,
    reason,
    actorId: gate.profile.id,
  });
  if (!result.ok) return result;
  revalidateMarketing();
  return {
    ok: true,
    message: `Attribution conflict ${resolution}`,
  };
}

// Phase 50: propose (NEVER auto-approve) a dual-approve promotion from an
// existing Phase 49 dry-run snapshot that predicted 'would_promote'.
export async function proposeMarketingDryRunPromoteAction(
  dryRunId: string,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const parsed = z.object({ dryRunId: z.string().uuid() }).safeParse({
    dryRunId,
  });
  if (!parsed.success) {
    return { ok: false, error: 'Invalid dry-run snapshot id' };
  }
  const result = await proposeMarketingDryRunPromotePhase50({
    dryRunId: parsed.data.dryRunId,
    proposedBy: gate.profile.id,
  });
  if (!result.ok) return result;
  revalidateMarketing();
  return {
    ok: true,
    message: `Promotion proposal ${
      (result.data.proposal_id as string | undefined) ?? ''
    } recorded — requires 2 distinct human approvers`,
  };
}

// Phase 50: dual-approve gate. ALWAYS requires human approval for
// money-related promotions — never auto-approves. Only calls the existing
// Phase 47 cohort auto-reject promote RPC after 2 distinct approvers.
export async function approveMarketingDryRunPromoteAction(
  proposalId: string,
  decision: 'approve' | 'reject',
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const parsed = z
    .object({
      proposalId: z.string().uuid(),
      decision: z.enum(['approve', 'reject']),
    })
    .safeParse({ proposalId, decision });
  if (!parsed.success) {
    return { ok: false, error: 'Invalid dual-approve decision' };
  }
  const result = await approveMarketingDryRunPromotePhase50({
    proposalId: parsed.data.proposalId,
    actorId: gate.profile.id,
    decision: parsed.data.decision,
  });
  if (!result.ok) return result;
  revalidateMarketing();
  const disposition = result.data.disposition as string | undefined;
  return {
    ok: true,
    message: `Dual-approve promotion: ${disposition ?? 'recorded'}`,
  };
}

export async function upsertMarketingRevenueSourceAction(
  _prev: MarketingActionResult | null,
  formData: FormData,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  if (gate.profile.role !== 'visionary' && gate.profile.role !== 'admin') {
    return {
      ok: false,
      error: 'Only visionary or admin roles may configure revenue sources',
    };
  }
  const parsed = z
    .object({
      source_key: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,63}$/),
      display_name: z.string().min(2).max(200),
      entity_id: z.string().min(1).max(100),
      provider: z.enum(['meta_ads', 'linkedin_ads']),
      ad_account_id: z.string().min(1).max(200),
      external_account_id: z.string().min(1).max(300),
      endpoint_url: z.string().url(),
      credential_env_name: z.string().regex(/^[A-Z][A-Z0-9_]{2,127}$/),
      signature_env_name: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]{2,127}$/)
        .optional(),
      authenticity_mode: z.enum(REVENUE_AUTHENTICITY_MODES),
      ledger_profile: z.enum(REVENUE_LEDGER_PROFILES),
      ledger_kind: z.enum(REVENUE_LEDGER_KINDS),
      config_status: z.enum(['disabled', 'ready', 'invalid']),
    })
    .safeParse({
      source_key: formData.get('source_key'),
      display_name: formData.get('display_name'),
      entity_id: formData.get('entity_id'),
      provider: formData.get('provider'),
      ad_account_id: formData.get('ad_account_id'),
      external_account_id: formData.get('external_account_id'),
      endpoint_url: formData.get('endpoint_url'),
      credential_env_name: formData.get('credential_env_name'),
      signature_env_name: formData.get('signature_env_name') || undefined,
      authenticity_mode: formData.get('authenticity_mode'),
      ledger_profile: formData.get('ledger_profile') || 'sandbox_v1',
      ledger_kind: formData.get('ledger_kind') || 'ad_platform',
      config_status: formData.get('config_status') || 'disabled',
    });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      parsed.data.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(parsed.data.entity_id),
    };
  }
  const result = await upsertMarketingRevenueSource(parsed.data);
  if (!result.ok) return result;
  revalidateMarketing();
  return {
    ok: true,
    message: `Configured revenue source ${result.source_key}`,
  };
}

export async function bindMarketingRevenueCampaignAction(
  sourceId: string,
  sourceCampaignId: string,
  campaignId: string,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  if (gate.profile.role !== 'visionary' && gate.profile.role !== 'admin') {
    return {
      ok: false,
      error: 'Only visionary or admin roles may bind revenue campaigns',
    };
  }
  const sb = await createPersistClient();
  const { data: source, error: sourceError } = await sb
    .from('os_marketing_revenue_sources')
    .select('entity_id')
    .eq('source_id', sourceId)
    .maybeSingle();
  if (sourceError || !source) {
    return { ok: false, error: sourceError?.message ?? 'Source not found' };
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      source.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(source.entity_id),
    };
  }
  const result = await bindMarketingRevenueCampaign({
    sourceId,
    sourceCampaignId,
    campaignId,
  });
  if (!result.ok) return result;
  revalidateMarketing();
  return { ok: true, message: `Bound campaign ${campaignId}` };
}
