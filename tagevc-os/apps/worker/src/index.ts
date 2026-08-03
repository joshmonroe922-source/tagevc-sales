/**
 * Enrichment worker (C4–C6) — drains enrichment_jobs.
 * LIVE providers via bootstrap orchestrator; mock fallback when not LIVE.
 * Always stamps credit_ledger for paid calls.
 *
 * Run: cd apps/worker && npm i && npm start
 */

import { createClient } from '@supabase/supabase-js';
import { enrichmentKillSwitchEnabled } from '../../../src/lib/spine/enrichment/waterfall.js';
import {
  runAccountBootstrap,
  runContactEnrich,
} from '../../../src/lib/spine/enrichment/bootstrap.js';
import {
  getEnrichmentProviderHealth,
} from '../../../src/lib/spine/enrichment/providers.js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('SUPABASE URL + SERVICE_ROLE_KEY required');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const POLL_MS = Number(process.env.WORKER_POLL_MS || 5000);

type JobRow = {
  id: string;
  org_id: string;
  type: string;
  account_id: string | null;
  contact_id: string | null;
  payload: Record<string, unknown>;
  attempts: number | null;
  status: string;
};

async function claimJob(): Promise<JobRow | null> {
  if (enrichmentKillSwitchEnabled()) {
    console.log('ENRICHMENT_KILL_SWITCH on — idle');
    return null;
  }
  const { data } = await sb
    .from('enrichment_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const { data: claimed } = await sb
    .from('enrichment_jobs')
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
      attempts: (data.attempts ?? 0) + 1,
      progress_pct: 5,
      progress_message: 'claimed',
    })
    .eq('id', data.id)
    .eq('status', 'queued')
    .select('*')
    .maybeSingle();
  return claimed as JobRow | null;
}

async function failJob(jobId: string, message: string, status = 'failed') {
  await sb
    .from('enrichment_jobs')
    .update({
      status,
      progress_pct: 100,
      progress_message: message,
      finished_at: new Date().toISOString(),
      error: message,
    })
    .eq('id', jobId);
}

async function runRefreshStale(job: JobRow) {
  const accountId = job.account_id || String(job.payload.account_id || '');
  const contactId = job.contact_id || String(job.payload.contact_id || '');
  const day = new Date().toISOString().slice(0, 10);

  if (job.type === 'account.refresh_stale' && accountId) {
    await sb.from('enrichment_jobs').upsert(
      {
        org_id: job.org_id,
        type: 'account.bootstrap',
        payload: { account_id: accountId, org_id: job.org_id, expand: false },
        idempotency_key: `account.bootstrap:${accountId}:${job.org_id}:${day}:stale`,
        account_id: accountId,
        status: 'queued',
        parent_job_id: job.id,
      },
      { onConflict: 'idempotency_key' },
    );
  }
  if (job.type === 'contact.refresh_stale' && contactId) {
    await sb
      .from('contacts')
      .update({ enrich_status: 'pending' })
      .eq('id', contactId);
  }
  await sb
    .from('enrichment_jobs')
    .update({
      status: 'succeeded',
      progress_pct: 100,
      progress_message: 'stale refresh enqueued',
      finished_at: new Date().toISOString(),
    })
    .eq('id', job.id);
}

async function runJobChange(job: JobRow) {
  const contactId = String(job.payload.contact_id || job.contact_id || '');
  const newAccountId = String(job.payload.new_account_id || '');
  const title = (job.payload.title as string) || null;
  if (!contactId || !newAccountId) {
    await failJob(job.id, 'missing contact_id/new_account_id');
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  await sb
    .from('employments')
    .update({ is_current: false, ended_on: today })
    .eq('contact_id', contactId)
    .eq('is_current', true);
  await sb.from('employments').insert({
    contact_id: contactId,
    account_id: newAccountId,
    title,
    is_current: true,
    started_on: today,
    source: 'signal.job_change',
  });
  await sb
    .from('enrichment_jobs')
    .update({
      status: 'succeeded',
      progress_pct: 100,
      progress_message: 'employment rolled',
      finished_at: new Date().toISOString(),
    })
    .eq('id', job.id);
}

async function runDataQaJob(job: JobRow) {
  const { runDataQaPass } = await import(
    '../../../src/lib/spine/agents/data-qa.js'
  );
  const report = await runDataQaPass(sb, job.org_id, { limit: 40 });
  await sb
    .from('enrichment_jobs')
    .update({
      status: 'succeeded',
      progress_pct: 100,
      progress_message: `data_qa flags=${report.flags.length}`,
      finished_at: new Date().toISOString(),
      provider_trace: report.flags.slice(0, 20),
    })
    .eq('id', job.id);
}

async function loop() {
  const health = getEnrichmentProviderHealth();
  console.log('Enrichment worker started', {
    pollMs: POLL_MS,
    ready: health.filter((h) => h.ready).map((h) => h.provider),
  });
  for (;;) {
    let job: JobRow | null = null;
    try {
      job = await claimJob();
      if (!job) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }
      console.log('job', job.id, job.type);
      if (job.type === 'account.bootstrap' || job.type === 'account.enrich') {
        await runAccountBootstrap(sb, job);
      } else if (
        job.type === 'contact.bootstrap' ||
        job.type === 'contact.enrich'
      ) {
        await runContactEnrich(sb, job);
      } else if (job.type === 'account.refresh_stale') {
        await runAccountBootstrap(sb, {
          ...job,
          type: 'account.enrich',
          payload: { ...job.payload, expand: false },
        });
      } else if (job.type === 'contact.refresh_stale') {
        await runContactEnrich(sb, job);
      } else if (job.type === 'signal.job_change') {
        await runJobChange(job);
      } else if (job.type === 'agent.data_qa') {
        await runDataQaJob(job);
      } else {
        await sb
          .from('enrichment_jobs')
          .update({
            status: 'succeeded',
            progress_pct: 100,
            progress_message: `noop handler for ${job.type}`,
            finished_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      }
    } catch (e) {
      console.error(e);
      if (job?.id) {
        await failJob(
          job.id,
          e instanceof Error ? e.message : 'worker_error',
        );
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

void loop();
