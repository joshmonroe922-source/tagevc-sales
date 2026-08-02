/**
 * Enrichment worker skeleton (C4) — drains enrichment_jobs with mock providers.
 * Run: cd apps/worker && npm i && npm start  (needs DATABASE_URL or SUPABASE_*)
 *
 * Live Apollo/PDL/Hunter only when *_LIVE + keys set; default is mock enrich.
 */

import { createClient } from '@supabase/supabase-js';
import {
  enrichmentKillSwitchEnabled,
  mockEnrichCompany,
  mockExpandPeople,
} from '../../../src/lib/spine/enrichment/waterfall.ts';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('SUPABASE URL + SERVICE_ROLE_KEY required');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const POLL_MS = Number(process.env.WORKER_POLL_MS || 5000);

async function claimJob() {
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
  return claimed;
}

async function runAccountBootstrap(job: {
  id: string;
  org_id: string;
  account_id: string | null;
  payload: Record<string, unknown>;
}) {
  const accountId = job.account_id || String(job.payload.account_id || '');
  if (!accountId) throw new Error('missing account_id');

  await sb
    .from('enrichment_jobs')
    .update({ progress_pct: 20, progress_message: 'loading account' })
    .eq('id', job.id);

  const { data: account } = await sb
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .single();
  if (!account) throw new Error('account not found');

  const domain = account.canonical_domain || 'example.com';
  const firm = mockEnrichCompany(domain);

  await sb
    .from('accounts')
    .update({
      name: account.name || firm.name,
      industry: account.industry || firm.industry,
      employee_count: account.employee_count || firm.employee_count,
      enrich_status: 'enriched',
      last_enriched_at: new Date().toISOString(),
      enrichment_version: (account.enrichment_version ?? 0) + 1,
    })
    .eq('id', accountId);

  await sb.from('enrichment_evidence').insert({
    job_id: job.id,
    provider: firm.provider,
    request_meta: { domain },
    normalized: firm,
  });

  await sb
    .from('enrichment_jobs')
    .update({ progress_pct: 60, progress_message: 'expand people (mock)' })
    .eq('id', job.id);

  const { data: org } = await sb
    .from('organizations')
    .select('icp_title_patterns, auto_expand_cap')
    .eq('id', job.org_id)
    .maybeSingle();

  const patterns = (org?.icp_title_patterns as string[]) || ['CEO'];
  const cap = Math.min(
    Number(job.payload.cap || org?.auto_expand_cap || 5),
    10,
  );
  const people = mockExpandPeople({ domain, patterns, cap });

  for (const p of people) {
    const { data: contact } = await sb
      .from('contacts')
      .insert({
        full_name: p.full_name,
        title: p.title,
        enrich_status: 'pending',
      })
      .select('id')
      .single();
    if (!contact) continue;
    await sb.from('contact_org_links').upsert({
      contact_id: contact.id,
      org_id: job.org_id,
      visibility: 'org',
    });
    await sb.from('employments').insert({
      contact_id: contact.id,
      account_id: accountId,
      title: p.title,
      is_current: true,
      source: 'mock_expand',
    });
  }

  await sb
    .from('enrichment_jobs')
    .update({
      status: 'succeeded',
      progress_pct: 100,
      progress_message: `mock bootstrap + ${people.length} people`,
      finished_at: new Date().toISOString(),
      provider_trace: [{ provider: 'cache', step: 'account.bootstrap' }],
    })
    .eq('id', job.id);
}

async function loop() {
  console.log('Enrichment worker started', { pollMs: POLL_MS });
  for (;;) {
    try {
      const job = await claimJob();
      if (!job) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }
      console.log('job', job.id, job.type);
      if (job.type === 'account.bootstrap' || job.type === 'account.enrich') {
        await runAccountBootstrap(job);
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
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

void loop();
