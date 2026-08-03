/**
 * Account bootstrap orchestrator — LIVE providers when ready, mock otherwise.
 *
 * Budget-first order (Josh): email signatures → website meta → paid (Apollo last).
 * People expand: Apollo search only after free stages, when LIVE + apollo_org_id; else mock.
 * Contact writes go through merge engine (user locks → suggested_updates).
 */

import {
  apolloEnrichCompany,
  apolloSearchPeople,
  hunterFindEmail,
  pdlEnrichPerson,
  zeroBounceVerify,
  type ApolloOrgResult,
  type ApolloPersonStub,
} from './providers';
import {
  budgetAllowsSpend,
  enrichmentKillSwitchEnabled,
  fetchWebsiteMeta,
  mockEnrichCompany,
  mockExpandPeople,
  scrapeEmailSignatureScaffold,
  type MockCompanyEnrich,
  type MockPersonEnrich,
} from './waterfall';
import { PROVIDER_COST_USD } from './credit';
import { recordCreditSpend, sumMonthSpendUsd } from './ledger';
import { decideMergeField, contactDedupeScore } from '../merge/engine';
import type { MergeSource } from '../db/types';

/* eslint-disable @typescript-eslint/no-explicit-any -- worker Supabase client is untyped by design */
export type BootstrapSb = {
  from: (table: string) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export type BootstrapJob = {
  id: string;
  org_id: string;
  account_id: string | null;
  contact_id?: string | null;
  payload: Record<string, unknown>;
  type: string;
};

const MAX_EXPAND_CAP = 75;

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

type ExpandPerson = MockPersonEnrich & {
  linkedin_url?: string | null;
  apollo_id?: string | null;
};

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
  const doExpand = job.payload.expand !== false;

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

  await setProgress(sb, job.id, 25, 'company enrich (budget-first)');

  let firm: MockCompanyEnrich | ApolloOrgResult = mockEnrichCompany(domain);
  let usedLiveCompany = false;

  // Stage 1 — email signatures (scaffold / backlog; free)
  const sig = scrapeEmailSignatureScaffold({ accountId });
  trace.push({
    provider: 'email_signature',
    step: 'company.enrich',
    skipped: true,
    reason: sig.error,
  });

  // Stage 2 — company + external websites (free public meta)
  const site = await fetchWebsiteMeta(domain);
  if (site.ok && site.title) {
    firm = {
      ...firm,
      name: account.name || firm.name,
      provider: 'website_meta',
    };
    trace.push({
      provider: 'website_meta',
      step: 'company.enrich',
      live: true,
      title: site.title,
    });
  } else {
    trace.push({
      provider: 'website_meta',
      step: 'company.enrich',
      skipped: true,
      reason: 'no_title',
    });
  }

  // Stage 3 — paid: Apollo last when LIVE
  const liveAttempt = await apolloEnrichCompany({
    domain,
    monthSpendUsd: monthSpend,
    budgetUsd,
  });

  if (liveAttempt.ok) {
    firm = liveAttempt.data;
    usedLiveCompany = true;
    await recordCreditSpend({
      sb,
      orgId: job.org_id,
      provider: 'apollo',
      usd: liveAttempt.costUsd,
      jobId: job.id,
      note: `company.enrich:${domain}`,
    });
    monthSpend += liveAttempt.costUsd;
    trace.push({ provider: 'apollo', step: 'company.enrich', live: true });
  } else if (
    liveAttempt.error === 'budget_exceeded' ||
    liveAttempt.error === 'budget_zero'
  ) {
    await setProgress(sb, job.id, 100, liveAttempt.error, {
      status: 'budget_blocked',
      finished_at: new Date().toISOString(),
      provider_trace: [...trace, { provider: 'apollo', error: liveAttempt.error }],
    });
    return;
  } else {
    trace.push({
      provider: 'apollo',
      step: 'company.enrich',
      live: false,
      reason: liveAttempt.error,
    });
  }

  const apolloOrgId =
    account.apollo_org_id || firm.apollo_org_id || null;

  await sb
    .from('accounts')
    .update({
      name: account.name || firm.name,
      industry: account.industry || firm.industry,
      employee_count: account.employee_count || firm.employee_count,
      apollo_org_id: apolloOrgId,
      enrich_status: 'enriched',
      last_enriched_at: new Date().toISOString(),
      enrichment_version: (account.enrichment_version ?? 0) + 1,
    })
    .eq('id', accountId);

  await sb.from('enrichment_evidence').insert({
    job_id: job.id,
    provider: firm.provider,
    request_meta: { domain, live: usedLiveCompany },
    normalized: firm,
  });

  if (!doExpand) {
    await setProgress(sb, job.id, 100, 'company enrich only', {
      status: 'succeeded',
      finished_at: new Date().toISOString(),
      provider_trace: trace,
    });
    return;
  }

  const patterns = (org?.icp_title_patterns as string[]) || ['CEO'];
  const rawCap = Number(job.payload.cap || org?.auto_expand_cap || 5);
  const cap = Math.min(Math.max(1, rawCap), MAX_EXPAND_CAP);

  await setProgress(sb, job.id, 55, 'expand people');

  let people: ExpandPerson[] = [];
  let peopleSource: 'apollo' | 'mock' = 'mock';

  if (apolloOrgId) {
    const searched = await apolloSearchPeople({
      apolloOrgId: String(apolloOrgId),
      titles: patterns,
      cap,
      monthSpendUsd: monthSpend,
      budgetUsd,
    });
    if (searched.ok && searched.people.length) {
      people = searched.people.map((p: ApolloPersonStub) => ({
        full_name: p.full_name,
        title: p.title,
        email: p.email,
        email_status: 'unknown' as const,
        provider: 'apollo' as const,
        linkedin_url: p.linkedin_url,
        apollo_id: p.apollo_id,
      }));
      peopleSource = 'apollo';
      await recordCreditSpend({
        sb,
        orgId: job.org_id,
        provider: 'apollo',
        usd: searched.costUsd,
        jobId: job.id,
        note: `people.search:${domain}:${searched.people.length}`,
      });
      monthSpend += searched.costUsd;
      trace.push({
        provider: 'apollo',
        step: 'people.search',
        live: true,
        count: searched.people.length,
      });
    } else {
      trace.push({
        provider: 'apollo',
        step: 'people.search',
        skipped: true,
        reason: searched.ok ? 'empty' : searched.error,
      });
    }
  }

  if (!people.length) {
    people = mockExpandPeople({ domain, patterns, cap });
    peopleSource = 'mock';
    trace.push({
      provider: 'cache',
      step: 'people.expand',
      live: false,
      reason: apolloOrgId ? 'apollo_empty_or_not_live' : 'no_apollo_org_id',
    });
  }

  let written = 0;
  for (const p of people) {
    const person = await enrichPersonWaterfall(sb, {
      person: p,
      domain,
      orgId: job.org_id,
      jobId: job.id,
      monthSpend,
      budgetUsd,
      trace,
    });
    monthSpend = person.monthSpend;

    const contactId = await upsertContactViaMerge(sb, {
      orgId: job.org_id,
      accountId,
      person,
      jobId: job.id,
      source: peopleSource === 'apollo' ? 'apollo' : 'agent',
    });
    if (contactId) written += 1;
  }

  await setProgress(
    sb,
    job.id,
    100,
    `bootstrap + ${written}/${people.length} people (${peopleSource})`,
    {
      status: 'succeeded',
      finished_at: new Date().toISOString(),
      provider_trace: trace.length
        ? trace
        : [{ provider: 'cache', step: 'account.bootstrap' }],
    },
  );
}

/** contact.enrich / contact.bootstrap — person waterfall + merge. */
export async function runContactEnrich(
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

  const contactId =
    job.contact_id || String(job.payload.contact_id || '');
  if (!contactId) throw new Error('missing contact_id');

  await setProgress(sb, job.id, 15, 'loading contact');
  const { data: contact } = await sb
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .single();
  if (!contact) throw new Error('contact not found');

  const { data: org } = await sb
    .from('organizations')
    .select('monthly_enrichment_budget_usd')
    .eq('id', job.org_id)
    .maybeSingle();
  const budgetUsd = Number(org?.monthly_enrichment_budget_usd ?? 50);
  let monthSpend = await sumMonthSpendUsd(sb, job.org_id);
  const trace: Array<Record<string, unknown>> = [];

  const { data: emp } = await sb
    .from('employments')
    .select('account_id, accounts(canonical_domain)')
    .eq('contact_id', contactId)
    .eq('is_current', true)
    .limit(1)
    .maybeSingle();
  const accountId = emp?.account_id ? String(emp.account_id) : null;
  const domain =
    (emp?.accounts as { canonical_domain?: string } | null)
      ?.canonical_domain ||
    String(job.payload.domain || 'example.com');

  const seed: ExpandPerson = {
    full_name: contact.full_name,
    title: contact.title,
    email: contact.primary_email,
    email_status: 'unknown',
    provider: 'cache',
    linkedin_url: contact.linkedin_url,
  };

  const person = await enrichPersonWaterfall(sb, {
    person: seed,
    domain,
    orgId: job.org_id,
    jobId: job.id,
    monthSpend,
    budgetUsd,
    trace,
  });

  await upsertContactViaMerge(sb, {
    orgId: job.org_id,
    accountId,
    person,
    jobId: job.id,
    source: 'pdl',
    existingContactId: contactId,
  });

  await setProgress(sb, job.id, 100, 'contact enrich done', {
    status: 'succeeded',
    finished_at: new Date().toISOString(),
    provider_trace: trace,
  });
}

async function enrichPersonWaterfall(
  sb: BootstrapSb,
  input: {
    person: ExpandPerson;
    domain: string;
    orgId: string;
    jobId: string;
    monthSpend: number;
    budgetUsd: number;
    trace: Array<Record<string, unknown>>;
  },
): Promise<ExpandPerson & { monthSpend: number }> {
  let monthSpend = input.monthSpend;
  let person = { ...input.person };

  // Budget-first: signature → website → hunter → ZB → PDL → Apollo last
  const sig = scrapeEmailSignatureScaffold();
  input.trace.push({
    provider: 'email_signature',
    step: 'person.enrich',
    skipped: true,
    reason: sig.error,
  });

  const site = await fetchWebsiteMeta(input.domain);
  input.trace.push({
    provider: 'website_meta',
    step: 'person.enrich',
    skipped: !site.ok,
    title: site.title,
    reason: site.ok ? undefined : 'no_title',
  });

  if (!person.email) {
    const gate = budgetAllowsSpend({
      monthSpendUsd: monthSpend,
      estimateUsd: PROVIDER_COST_USD.hunter_email,
      budgetUsd: input.budgetUsd,
    });
    if (gate.ok) {
      const found = await hunterFindEmail({
        domain: input.domain,
        fullName: person.full_name,
        monthSpendUsd: monthSpend,
        budgetUsd: input.budgetUsd,
      });
      if (found.ok) {
        await recordCreditSpend({
          sb,
          orgId: input.orgId,
          provider: 'hunter',
          usd: found.costUsd,
          jobId: input.jobId,
          note: `email.find:${person.full_name}`,
        });
        monthSpend += found.costUsd;
        person.email = found.email;
        person.email_status = 'unknown';
        input.trace.push({
          provider: 'hunter',
          step: 'email.find',
          live: true,
        });
      } else {
        input.trace.push({
          provider: 'hunter',
          skipped: true,
          reason: found.error,
        });
      }
    }
  }

  if (person.email) {
    const verified = await zeroBounceVerify(person.email);
    if (verified.ok) {
      await recordCreditSpend({
        sb,
        orgId: input.orgId,
        provider: 'zerobounce',
        usd: verified.costUsd,
        jobId: input.jobId,
        note: `email.verify:${person.email}`,
      });
      monthSpend += verified.costUsd;
      person.email_status =
        verified.status === 'valid'
          ? 'valid'
          : verified.status === 'invalid'
            ? 'unknown'
            : 'unknown';
      input.trace.push({
        provider: 'zerobounce',
        status: verified.status,
        live: true,
      });
      if (verified.status !== 'valid') {
        // Keep email off primary until verified (R3) — store as candidate via suggest path
        person = { ...person, email: null, email_status: 'unknown' };
      }
    } else {
      input.trace.push({
        provider: 'zerobounce',
        skipped: true,
        reason: verified.error,
      });
      // Without ZB LIVE, do not write unverified email as primary
      person = { ...person, email: null, email_status: 'unknown' };
    }
  }

  // Paid person enrich after free + cheaper find/verify — still before Apollo
  const needsPaid =
    !person.email || !person.title || !person.linkedin_url;
  if (needsPaid) {
    const pdl = await pdlEnrichPerson({
      fullName: person.full_name,
      email: person.email,
      linkedinUrl: person.linkedin_url,
      companyDomain: input.domain,
      monthSpendUsd: monthSpend,
      budgetUsd: input.budgetUsd,
    });
    if (pdl.ok) {
      await recordCreditSpend({
        sb,
        orgId: input.orgId,
        provider: 'pdl',
        usd: pdl.costUsd,
        jobId: input.jobId,
        note: `person.enrich:${person.full_name}`,
      });
      monthSpend += pdl.costUsd;
      person = {
        ...person,
        full_name: pdl.data.full_name || person.full_name,
        title: pdl.data.title || person.title,
        email: pdl.data.email || person.email,
        linkedin_url: pdl.data.linkedin_url || person.linkedin_url,
        provider: 'pdl',
      };
      input.trace.push({ provider: 'pdl', step: 'person.enrich', live: true });
    } else {
      input.trace.push({
        provider: 'pdl',
        skipped: true,
        reason: pdl.error,
      });
    }
  }

  // Apollo person match is last (people expand already used Apollo stubs when LIVE)
  if (person.provider === 'apollo' || person.apollo_id) {
    input.trace.push({
      provider: 'apollo',
      step: 'person.enrich',
      live: true,
      note: 'stub_from_people_search',
    });
  } else {
    input.trace.push({
      provider: 'apollo',
      step: 'person.enrich',
      skipped: true,
      reason: 'apollo_last_no_person_match_needed',
    });
  }

  return { ...person, monthSpend };
}

async function upsertContactViaMerge(
  sb: BootstrapSb,
  input: {
    orgId: string;
    accountId: string | null;
    person: ExpandPerson;
    jobId: string;
    source: MergeSource;
    existingContactId?: string;
  },
): Promise<string | null> {
  let contactId = input.existingContactId || null;

  // Dedupe by email / linkedin / name+account
  if (!contactId && input.person.email) {
    const { data: byEmail } = await sb
      .from('contacts')
      .select('id, full_name, primary_email, linkedin_url')
      .ilike('primary_email', input.person.email)
      .maybeSingle();
    if (byEmail?.id) contactId = String(byEmail.id);
  }

  if (!contactId) {
    const { data: candidates } = await sb
      .from('contacts')
      .select('id, full_name, primary_email, linkedin_url')
      .ilike('full_name', input.person.full_name)
      .limit(5);
    for (const c of candidates ?? []) {
      const score = contactDedupeScore(
        {
          email: input.person.email,
          linkedin: input.person.linkedin_url,
          fullName: input.person.full_name,
          accountId: input.accountId,
        },
        {
          email: c.primary_email,
          linkedin: c.linkedin_url,
          fullName: c.full_name,
          accountId: input.accountId,
        },
      );
      if (score >= 0.92) {
        contactId = String(c.id);
        break;
      }
    }
  }

  if (!contactId) {
    const parts = input.person.full_name.trim().split(/\s+/);
    const { data: created, error } = await sb
      .from('contacts')
      .insert({
        full_name: input.person.full_name,
        first_name: parts[0] || null,
        last_name: parts.slice(1).join(' ') || null,
        title: input.person.title,
        linkedin_url: input.person.linkedin_url || null,
        enrich_status: 'pending',
      })
      .select('id')
      .single();
    if (error || !created) return null;
    contactId = String(created.id);
  }

  await sb.from('contact_org_links').upsert({
    contact_id: contactId,
    org_id: input.orgId,
    visibility: 'org',
  });

  // Load provenance locks
  const { data: prov } = await sb
    .from('field_provenance')
    .select('field_name, value, source, locked')
    .eq('entity_type', 'contact')
    .eq('entity_id', contactId);
  const provMap = new Map(
    (prov ?? []).map((p: { field_name: string; value: string | null; source: string; locked: boolean }) => [
      p.field_name,
      p,
    ]),
  );

  const { data: existing } = await sb
    .from('contacts')
    .select('full_name, title, primary_email, linkedin_url')
    .eq('id', contactId)
    .single();

  const fields: Array<{
    field: string;
    value: string | null;
    emailStatus?: string;
  }> = [
    { field: 'title', value: input.person.title },
    { field: 'linkedin_url', value: input.person.linkedin_url || null },
    {
      field: 'primary_email',
      value: input.person.email,
      emailStatus: input.person.email_status,
    },
  ];

  const patch: Record<string, unknown> = {
    enrich_status: 'enriched',
    last_enriched_at: new Date().toISOString(),
  };

  for (const f of fields) {
    if (!f.value) continue;
    const p = provMap.get(f.field);
    const decision = decideMergeField({
      field: f.field,
      value: f.value,
      source: input.source,
      emailStatus: f.emailStatus,
      existingValue:
        (existing?.[f.field as keyof typeof existing] as string | null) ??
        null,
      existingSource: p?.source ?? null,
      existingLocked: Boolean(p?.locked),
      locked: Boolean(p?.locked),
    });

    if (decision.action === 'write') {
      patch[f.field] = decision.value;
      if (f.field === 'primary_email') {
        patch.primary_email_status = f.emailStatus || 'valid';
      }
      await sb.from('field_provenance').upsert(
        {
          entity_type: 'contact',
          entity_id: contactId,
          field_name: f.field,
          value: decision.value,
          source: decision.source,
          confidence: decision.confidence,
          locked: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'entity_type,entity_id,field_name' },
      );
    } else if (decision.action === 'suggest') {
      await sb.from('suggested_updates').insert({
        org_id: input.orgId,
        entity_type: 'contact',
        entity_id: contactId,
        field_name: f.field,
        suggested_value: decision.value,
        status: 'pending',
        source: decision.source,
        reason: decision.reason,
        job_id: input.jobId,
      });
    }
  }

  await sb.from('contacts').update(patch).eq('id', contactId);

  if (input.accountId) {
    const { data: existingEmp } = await sb
      .from('employments')
      .select('id')
      .eq('contact_id', contactId)
      .eq('account_id', input.accountId)
      .eq('is_current', true)
      .maybeSingle();
    if (existingEmp?.id) {
      await sb
        .from('employments')
        .update({
          title: input.person.title,
          source: input.source === 'apollo' ? 'apollo_expand' : 'enrich',
        })
        .eq('id', existingEmp.id);
    } else {
      await sb.from('employments').insert({
        contact_id: contactId,
        account_id: input.accountId,
        title: input.person.title,
        is_current: true,
        source: input.source === 'apollo' ? 'apollo_expand' : 'enrich',
      });
    }
  }

  return contactId;
}
