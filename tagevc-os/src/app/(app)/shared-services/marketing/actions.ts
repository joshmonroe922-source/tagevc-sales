'use server';

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
