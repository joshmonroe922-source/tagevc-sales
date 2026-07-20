'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  approveContent,
  createCampaign,
  createContent,
  enqueueScheduleJob,
  registerSocialAccount,
  runContentGeneration,
} from '@/lib/shared-services/marketing-repo';
import { upsertBrandVoice } from '@/lib/shared-services/marketing-brand';
import { processDueScheduleJobs } from '@/lib/shared-services/marketing-scheduler';
import { MARKETING_CONTENT_KINDS, MARKETING_PLATFORMS } from '@/lib/shared-services/marketing-types';
import { guardPermission } from '@/lib/rbac/session';

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
    })
    .safeParse({
      name: formData.get('name'),
      entity_id: formData.get('entity_id') || undefined,
      objective: formData.get('objective') || undefined,
      notes: formData.get('notes') || undefined,
    });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const res = await createCampaign({
    name: parsed.data.name,
    entity_id: parsed.data.entity_id || null,
    objective: parsed.data.objective || null,
    notes: parsed.data.notes || null,
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
    })
    .safeParse({
      title: formData.get('title'),
      kind: formData.get('kind'),
      body: formData.get('body') || undefined,
      campaign_id: formData.get('campaign_id') || undefined,
      entity_id: formData.get('entity_id') || undefined,
      platform: formData.get('platform') || undefined,
    });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const res = await createContent({
    title: parsed.data.title,
    kind: parsed.data.kind,
    body: parsed.data.body || null,
    campaign_id: parsed.data.campaign_id || null,
    entity_id: parsed.data.entity_id || null,
    platform: parsed.data.platform || null,
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
    })
    .safeParse({
      platform: formData.get('platform'),
      handle: formData.get('handle'),
      display_name: formData.get('display_name') || undefined,
      entity_id: formData.get('entity_id') || undefined,
      notes: formData.get('notes') || undefined,
    });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const res = await registerSocialAccount({
    platform: parsed.data.platform,
    handle: parsed.data.handle,
    display_name: parsed.data.display_name || null,
    entity_id: parsed.data.entity_id || null,
    notes: parsed.data.notes || null,
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

  const res = await enqueueScheduleJob({
    content_id: contentId,
    scheduled_for: scheduledFor,
    account_id: accountId || null,
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

export async function stubConnectAccountAction(
  accountId: string,
): Promise<MarketingActionResult> {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) return gate;
  const { stubConnectAccount } = await import(
    '@/lib/shared-services/marketing-oauth'
  );
  const res = await stubConnectAccount(accountId);
  if (!res.ok) return res;
  revalidateMarketing();
  return { ok: true, message: `Stub-connected ${accountId}` };
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
