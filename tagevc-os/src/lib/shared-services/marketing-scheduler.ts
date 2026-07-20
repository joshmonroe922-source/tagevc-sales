/**
 * Schedule / automation engine (Phase 23) — drain queue and publish.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { publishForAccount } from '@/lib/shared-services/marketing-social';
import type { MarketingJobStatus } from './marketing-types';

export type ScheduleEnqueueInput = {
  content_id: string;
  account_id?: string | null;
  entity_id?: string | null;
  scheduled_for: string;
};

export function isMarketingSchedulerEnabled(): boolean {
  const v = process.env.MARKETING_SCHEDULER_ENABLED?.trim();
  return v === '1' || v === 'true';
}

export function validateScheduleInput(
  input: ScheduleEnqueueInput,
): { ok: true } | { ok: false; error: string } {
  if (!input.content_id?.trim()) {
    return { ok: false, error: 'content_id required' };
  }
  const when = Date.parse(input.scheduled_for);
  if (Number.isNaN(when)) {
    return { ok: false, error: 'scheduled_for must be a valid ISO datetime' };
  }
  return { ok: true };
}

export type WorkerJobResult = {
  job_id: string;
  ok: boolean;
  status: MarketingJobStatus;
  published_url?: string;
  error?: string;
  stub?: boolean;
};

/**
 * Process due pending/queued schedule jobs (limit).
 * When MARKETING_SCHEDULER_ENABLED is false, still processes if force=true (manual run).
 */
export async function processDueScheduleJobs(opts?: {
  limit?: number;
  force?: boolean;
  now?: Date;
}): Promise<{
  processed: WorkerJobResult[];
  skipped: boolean;
  reason?: string;
}> {
  if (!isMarketingSchedulerEnabled() && !opts?.force) {
    return {
      processed: [],
      skipped: true,
      reason: 'MARKETING_SCHEDULER_ENABLED is off — pass force or enable env',
    };
  }

  const limit = opts?.limit ?? 10;
  const nowIso = (opts?.now ?? new Date()).toISOString();
  const sb = await createPersistClient();

  const { data: jobs, error } = await sb
    .from('os_marketing_schedule_jobs')
    .select('*')
    .in('status', ['pending', 'queued'])
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(limit);

  if (error) {
    return {
      processed: [],
      skipped: false,
      reason: error.message,
    };
  }

  const results: WorkerJobResult[] = [];

  for (const raw of jobs ?? []) {
    const job = raw as Record<string, unknown>;
    const jobId = String(job.job_id);
    const contentId = String(job.content_id);
    const accountId = (job.account_id as string) || null;
    const attempts = Number(job.attempts ?? 0) + 1;

    await sb
      .from('os_marketing_schedule_jobs')
      .update({ status: 'running', attempts, updated_at: nowIso })
      .eq('job_id', jobId);

    const { data: contentRow } = await sb
      .from('os_marketing_content')
      .select('*')
      .eq('content_id', contentId)
      .maybeSingle();

    if (!contentRow) {
      await sb
        .from('os_marketing_schedule_jobs')
        .update({
          status: 'failed',
          last_error: 'Content not found',
          updated_at: nowIso,
        })
        .eq('job_id', jobId);
      results.push({
        job_id: jobId,
        ok: false,
        status: 'failed',
        error: 'Content not found',
      });
      continue;
    }

    const content = contentRow as Record<string, unknown>;
    let platform = (content.platform as string) || 'linkedin';
    let handle = 'tagevc';
    let resolvedAccountId = accountId;

    if (resolvedAccountId) {
      const { data: acct } = await sb
        .from('os_marketing_social_accounts')
        .select('*')
        .eq('account_id', resolvedAccountId)
        .maybeSingle();
      if (acct) {
        platform = String((acct as { platform: string }).platform);
        handle = String((acct as { handle: string }).handle);
      }
    } else {
      const { data: acct } = await sb
        .from('os_marketing_social_accounts')
        .select('*')
        .eq('status', 'connected')
        .eq('platform', platform)
        .limit(1)
        .maybeSingle();
      if (acct) {
        resolvedAccountId = String((acct as { account_id: string }).account_id);
        handle = String((acct as { handle: string }).handle);
      }
    }

    if (!resolvedAccountId) {
      // Allow stub publish without account for firm demos
      resolvedAccountId = 'MSA-STUB';
    }

    const pub = await publishForAccount({
      account_id: resolvedAccountId,
      platform: platform as 'linkedin' | 'x' | 'instagram' | 'facebook' | 'youtube' | 'web' | 'other',
      handle,
      title: String(content.title ?? ''),
      body: String(content.body ?? ''),
    });

    if (pub.ok) {
      await sb
        .from('os_marketing_schedule_jobs')
        .update({
          status: 'succeeded',
          last_error: null,
          published_url: pub.published_url ?? null,
          publisher: pub.publisher,
          result: {
            external_id: pub.external_id,
            stub: pub.stub ?? false,
          },
          updated_at: nowIso,
        })
        .eq('job_id', jobId);

      await sb
        .from('os_marketing_content')
        .update({
          status: 'published',
          published_at: nowIso,
          updated_at: nowIso,
        })
        .eq('content_id', contentId);

      results.push({
        job_id: jobId,
        ok: true,
        status: 'succeeded',
        published_url: pub.published_url,
        stub: pub.stub,
      });
    } else {
      await sb
        .from('os_marketing_schedule_jobs')
        .update({
          status: 'failed',
          last_error: pub.error ?? 'publish failed',
          publisher: pub.publisher,
          updated_at: nowIso,
        })
        .eq('job_id', jobId);

      await sb
        .from('os_marketing_content')
        .update({ status: 'failed', updated_at: nowIso })
        .eq('content_id', contentId);

      results.push({
        job_id: jobId,
        ok: false,
        status: 'failed',
        error: pub.error,
      });
    }
  }

  return { processed: results, skipped: false };
}
