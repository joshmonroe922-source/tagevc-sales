/**
 * Account bootstrap orchestrator — LIVE providers when ready, mock otherwise.
 * Used by apps/worker (and unit-tested). No Next.js path aliases.
 */

import {
  apolloEnrichCompany,
  hunterFindEmail,
  zeroBounceVerify,
  type ApolloOrgResult,
} from './providers';
import {
  budgetAllowsSpend,
  enrichmentKillSwitchEnabled,
  mockEnrichCompany,
  mockExpandPeople,
  type MockCompanyEnrich,
  type MockPersonEnrich,
} from './waterfall';
import { recordCreditSpend, sumMonthSpendUsd } from './ledger';

/* eslint-disable @typescript-eslint/no-explicit-any -- worker Supabase client is untyped by design */
export type BootstrapSb = {
  from: (table: string) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export type BootstrapJob = {
  id: string;
  org_id: string;
  account_id: string | null;
  payload: Record<string, unknown>;
  type: string;
};

const APOLLO_USD = 0.05;
const HUNTER_USD = 0.02;

async function setProgress(
  sb: BootstrapSb,
  jobId: string,
  pct: number,
  message: string,
  extra?: Record<string, unknown>,
) {
  await sb
    .from('enrichment_jobs')
    .update({
      progress_pct: pct,
      progress_message: message,
      ...extra,
    })
    .eq('id', jobId);
}

export async function runAccountBootstrap(
  sb: BootstrapSb,
  job: BootstrapJob,
): Promise<void> {
  if (enrichmentKillSwitchEnabled()) {
    await setProgress(sb, job.id, 0, 'kill_switch', {
      status: 'cancelled',
      finished_at: new Date().toISOString(),
    });
    return;
  }

  const accountId = job.account_id || String(job.payload.account_id || '');
  if (!accountId) throw new Error('missing account_id');

  await setProgress(sb, job.id, 10, 'loading account');

  const { data: account } = await sb
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .single();
  if (!account) throw new Error('account not found');

  const { data: org } = await sb
    .from('organizations')
    .select(
      'icp_title_patterns, auto_expand_cap, monthly_enrichment_budget_usd',
    )
    .eq('id', job.org_id)
    .maybeSingle();

  const budgetUsd = Number(org?.monthly_enrichment_budget_usd ?? 50);
  let monthSpend = await sumMonthSpendUsd(sb, job.org_id);
  const domain = account.canonical_domain || 'example.com';
  const trace: Array<Record<string, unknown>> = [];

  await setProgress(sb, job.id, 25, 'company enrich');

  let firm: MockCompanyEnrich | ApolloOrgResult = mockEnrichCompany(domain);
  let usedLive = false;

  const liveAttempt = await apolloEnrichCompany({
    domain,
    monthSpendUsd: monthSpend,
    budgetUsd,
    estimateUsd: APOLLO_USD,
  });

  if (liveAttempt.ok) {
    firm = liveAttempt.data;
    usedLive = true;
    await recordCreditSpend({
      sb,
      orgId: job.org_id,
      provider: 'apollo',
      usd: APOLLO_USD,
      jobId: job.id,
      note: `company.enrich:${domain}`,
    });
    monthSpend += APOLLO_USD;
    trace.push({ provider: 'apollo', step: 'company.enrich', live: true });
  } else if (liveAttempt.error === 'budget_exceeded' || liveAttempt.error === 'budget_zero') {
    await setProgress(sb, job.id, 100, liveAttempt.error, {
      status: 'budget_blocked',
      finished_at: new Date().toISOString(),
      provider_trace: [{ provider: 'apollo', error: liveAttempt.error }],
    });
    return;
  } else {
    trace.push({
      provider: 'cache',
      step: 'company.enrich',
      live: false,
      reason: liveAttempt.error,
    });
  }

  await sb
    .from('accounts')
    .update({
      name: account.name || firm.name,
      industry: account.industry || firm.industry,
      employee_count: account.employee_count || firm.employee_count,
      apollo_org_id: account.apollo_org_id || firm.apollo_org_id,
      enrich_status: 'enriched',
      last_enriched_at: new Date().toISOString(),
      enrichment_version: (account.enrichment_version ?? 0) + 1,
    })
    .eq('id', accountId);

  await sb.from('enrichment_evidence').insert({
    job_id: job.id,
    provider: firm.provider,
    request_meta: { domain, live: usedLive },
    normalized: firm,
  });

  await setProgress(sb, job.id, 55, usedLive ? 'expand people (live/mock mix)' : 'expand people (mock)');

  const patterns = (org?.icp_title_patterns as string[]) || ['CEO'];
  const cap = Math.min(
    Number(job.payload.cap || org?.auto_expand_cap || 5),
    10,
  );
  const people = mockExpandPeople({ domain, patterns, cap });

  for (const p of people) {
    const person = await maybeEnrichPersonEmail(sb, {
      person: p,
      domain,
      orgId: job.org_id,
      jobId: job.id,
      monthSpend,
      budgetUsd,
      trace,
    });
    monthSpend = person.monthSpend;

    const { data: contact } = await sb
      .from('contacts')
      .insert({
        full_name: person.full_name,
        title: person.title,
        primary_email: person.email,
        primary_email_status: person.email_status,
        enrich_status: person.email ? 'enriched' : 'pending',
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
      title: person.title,
      is_current: true,
      source: usedLive ? 'expand' : 'mock_expand',
    });
  }

  await setProgress(sb, job.id, 100, `bootstrap + ${people.length} people`, {
    status: 'succeeded',
    finished_at: new Date().toISOString(),
    provider_trace: trace.length
      ? trace
      : [{ provider: 'cache', step: 'account.bootstrap' }],
  });
}

async function maybeEnrichPersonEmail(
  sb: BootstrapSb,
  input: {
    person: MockPersonEnrich;
    domain: string;
    orgId: string;
    jobId: string;
    monthSpend: number;
    budgetUsd: number;
    trace: Array<Record<string, unknown>>;
  },
): Promise<MockPersonEnrich & { monthSpend: number }> {
  let monthSpend = input.monthSpend;
  const gate = budgetAllowsSpend({
    monthSpendUsd: monthSpend,
    estimateUsd: HUNTER_USD,
    budgetUsd: input.budgetUsd,
  });
  if (!gate.ok) {
    return { ...input.person, monthSpend };
  }

  const found = await hunterFindEmail({
    domain: input.domain,
    fullName: input.person.full_name,
    monthSpendUsd: monthSpend,
    budgetUsd: input.budgetUsd,
  });
  if (!found.ok) {
    input.trace.push({
      provider: 'hunter',
      step: 'email.find',
      skipped: true,
      reason: found.error,
    });
    return { ...input.person, monthSpend };
  }

  await recordCreditSpend({
    sb,
    orgId: input.orgId,
    provider: 'hunter',
    usd: HUNTER_USD,
    jobId: input.jobId,
    note: `email.find:${input.person.full_name}`,
  });
  monthSpend += HUNTER_USD;
  input.trace.push({ provider: 'hunter', step: 'email.find', live: true });

  const verified = await zeroBounceVerify(found.email);
  if (!verified.ok) {
    input.trace.push({
      provider: 'zerobounce',
      skipped: true,
      reason: verified.error,
    });
    // Without verify LIVE, keep email as candidate only (not primary write of unverified)
    return {
      ...input.person,
      email: null,
      email_status: 'unknown',
      monthSpend,
    };
  }

  input.trace.push({
    provider: 'zerobounce',
    status: verified.status,
    live: true,
  });

  if (verified.status !== 'valid') {
    return {
      ...input.person,
      email: null,
      email_status: 'unknown' as const,
      monthSpend,
    };
  }

  return {
    ...input.person,
    email: found.email,
    email_status: 'valid' as const,
    monthSpend,
  };
}
