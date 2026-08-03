/**
 * Live-ready enrichment providers — fail closed without keys / LIVE flags.
 * Never invent API keys. Worker calls these; browser must not.
 * Relative imports so apps/worker can load via tsx without Next path aliases.
 */

import {
  budgetAllowsSpend,
  enrichmentKillSwitchEnabled,
  type ProviderName,
} from './waterfall';
import { PROVIDER_COST_USD } from './credit';

export type ProviderHealth = {
  provider: ProviderName | 'apollo' | 'pdl' | 'hunter' | 'zerobounce';
  configured: boolean;
  liveEnabled: boolean;
  ready: boolean;
  note: string;
};

function flag(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env[name] || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

function hasKey(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[name]?.trim());
}

export function getEnrichmentProviderHealth(
  env: NodeJS.ProcessEnv = process.env,
): ProviderHealth[] {
  const kill = enrichmentKillSwitchEnabled(env);
  const rows: Array<Omit<ProviderHealth, 'ready' | 'note'> & { note: string }> =
    [
      {
        provider: 'apollo',
        configured: hasKey('APOLLO_API_KEY', env),
        liveEnabled: flag('APOLLO_LIVE', env),
        note: 'Company + people search',
      },
      {
        provider: 'pdl',
        configured: hasKey('PDL_API_KEY', env),
        liveEnabled: flag('PDL_LIVE', env),
        note: 'Person enrich waterfall',
      },
      {
        provider: 'hunter',
        configured: hasKey('HUNTER_API_KEY', env),
        liveEnabled: flag('HUNTER_LIVE', env),
        note: 'Email finder',
      },
      {
        provider: 'zerobounce',
        configured: hasKey('ZEROBOUNCE_API_KEY', env),
        liveEnabled: flag('ZEROBOUNCE_LIVE', env),
        note: 'Email verify gate',
      },
    ];

  return rows.map((r) => ({
    ...r,
    ready: !kill && r.configured && r.liveEnabled,
    note: kill
      ? 'ENRICHMENT_KILL_SWITCH on'
      : !r.configured
        ? `Set ${r.provider.toUpperCase()}_API_KEY`
        : !r.liveEnabled
          ? `Set ${r.provider.toUpperCase()}_LIVE=1 when contract ready`
          : r.note,
  }));
}

export function isProviderReady(
  provider: 'apollo' | 'pdl' | 'hunter' | 'zerobounce',
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getEnrichmentProviderHealth(env).some(
    (h) => h.provider === provider && h.ready,
  );
}

export type ApolloOrgResult = {
  provider: 'apollo';
  name: string;
  domain: string;
  industry: string | null;
  employee_count: number | null;
  apollo_org_id: string | null;
  raw?: unknown;
};

export type ApolloPersonStub = {
  full_name: string;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  apollo_id: string | null;
};

export async function apolloEnrichCompany(input: {
  domain: string;
  monthSpendUsd: number;
  budgetUsd: number;
  estimateUsd?: number;
}): Promise<
  | { ok: true; data: ApolloOrgResult; costUsd: number }
  | { ok: false; error: string; skipped?: boolean }
> {
  if (enrichmentKillSwitchEnabled()) {
    return { ok: false, error: 'kill_switch', skipped: true };
  }
  if (!flag('APOLLO_LIVE') || !hasKey('APOLLO_API_KEY')) {
    return { ok: false, error: 'apollo_not_live', skipped: true };
  }
  const estimate = input.estimateUsd ?? PROVIDER_COST_USD.apollo_company;
  const gate = budgetAllowsSpend({
    monthSpendUsd: input.monthSpendUsd,
    estimateUsd: estimate,
    budgetUsd: input.budgetUsd,
  });
  if (!gate.ok) {
    return { ok: false, error: gate.reason || 'budget', skipped: true };
  }

  const key = process.env.APOLLO_API_KEY!.trim();
  const domain = input.domain.toLowerCase().replace(/^www\./, '');
  try {
    const res = await fetch(
      `https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': key,
        },
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        error: `apollo_http_${res.status}`,
      };
    }
    const json = (await res.json()) as {
      organization?: {
        id?: string;
        name?: string;
        primary_domain?: string;
        industry?: string;
        estimated_num_employees?: number;
      };
    };
    const org = json.organization;
    if (!org?.name) return { ok: false, error: 'apollo_empty' };
    return {
      ok: true,
      costUsd: estimate,
      data: {
        provider: 'apollo',
        name: org.name,
        domain: org.primary_domain || domain,
        industry: org.industry ?? null,
        employee_count: org.estimated_num_employees ?? null,
        apollo_org_id: org.id ?? null,
        raw: org,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'apollo_failed',
    };
  }
}

export async function apolloSearchPeople(input: {
  apolloOrgId: string;
  titles: string[];
  cap: number;
  monthSpendUsd: number;
  budgetUsd: number;
}): Promise<
  | { ok: true; people: ApolloPersonStub[]; costUsd: number }
  | { ok: false; error: string; skipped?: boolean }
> {
  if (enrichmentKillSwitchEnabled()) {
    return { ok: false, error: 'kill_switch', skipped: true };
  }
  if (!flag('APOLLO_LIVE') || !hasKey('APOLLO_API_KEY')) {
    return { ok: false, error: 'apollo_not_live', skipped: true };
  }
  const estimate = PROVIDER_COST_USD.apollo_people;
  const gate = budgetAllowsSpend({
    monthSpendUsd: input.monthSpendUsd,
    estimateUsd: estimate,
    budgetUsd: input.budgetUsd,
  });
  if (!gate.ok) {
    return { ok: false, error: gate.reason || 'budget', skipped: true };
  }

  const key = process.env.APOLLO_API_KEY!.trim();
  try {
    const res = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': key,
      },
      body: JSON.stringify({
        organization_ids: [input.apolloOrgId],
        person_titles: input.titles.slice(0, 20),
        per_page: Math.min(Math.max(1, input.cap), 25),
        page: 1,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `apollo_people_http_${res.status}` };
    }
    const json = (await res.json()) as {
      people?: Array<{
        id?: string;
        name?: string;
        title?: string;
        email?: string;
        linkedin_url?: string;
      }>;
    };
    const people: ApolloPersonStub[] = (json.people ?? [])
      .slice(0, input.cap)
      .map((p) => ({
        full_name: p.name || 'Unknown',
        title: p.title ?? null,
        email: p.email ?? null,
        linkedin_url: p.linkedin_url ?? null,
        apollo_id: p.id ?? null,
      }));
    return { ok: true, people, costUsd: estimate };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'apollo_people_failed',
    };
  }
}

export type PdlPersonResult = {
  provider: 'pdl';
  full_name: string;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  raw?: unknown;
};

/** Person enrich via People Data Labs — fail-closed without PDL_LIVE + key. */
export async function pdlEnrichPerson(input: {
  fullName?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  companyDomain?: string | null;
  monthSpendUsd: number;
  budgetUsd: number;
}): Promise<
  | { ok: true; data: PdlPersonResult; costUsd: number }
  | { ok: false; error: string; skipped?: boolean }
> {
  if (enrichmentKillSwitchEnabled()) {
    return { ok: false, error: 'kill_switch', skipped: true };
  }
  if (!flag('PDL_LIVE') || !hasKey('PDL_API_KEY')) {
    return { ok: false, error: 'pdl_not_live', skipped: true };
  }
  const estimate = PROVIDER_COST_USD.pdl_person;
  const gate = budgetAllowsSpend({
    monthSpendUsd: input.monthSpendUsd,
    estimateUsd: estimate,
    budgetUsd: input.budgetUsd,
  });
  if (!gate.ok) {
    return { ok: false, error: gate.reason || 'budget', skipped: true };
  }

  const key = process.env.PDL_API_KEY!.trim();
  const params = new URLSearchParams();
  if (input.email) params.set('email', input.email);
  if (input.fullName) params.set('name', input.fullName);
  if (input.linkedinUrl) params.set('profile', input.linkedinUrl);
  if (input.companyDomain) params.set('company', input.companyDomain);
  params.set('pretty', 'true');

  try {
    const res = await fetch(
      `https://api.peopledatalabs.com/v5/person/enrich?${params.toString()}`,
      {
        headers: {
          'X-Api-Key': key,
          'Content-Type': 'application/json',
        },
      },
    );
    if (res.status === 404) return { ok: false, error: 'pdl_not_found' };
    if (!res.ok) return { ok: false, error: `pdl_http_${res.status}` };
    const json = (await res.json()) as {
      data?: {
        full_name?: string;
        job_title?: string;
        work_email?: string;
        linkedin_url?: string;
      };
    };
    const d = json.data;
    if (!d?.full_name && !d?.work_email) {
      return { ok: false, error: 'pdl_empty' };
    }
    return {
      ok: true,
      costUsd: estimate,
      data: {
        provider: 'pdl',
        full_name: d.full_name || input.fullName || 'Unknown',
        title: d.job_title ?? null,
        email: d.work_email ?? null,
        linkedin_url: d.linkedin_url ?? null,
        raw: d,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'pdl_failed',
    };
  }
}

export async function hunterFindEmail(input: {
  domain: string;
  fullName: string;
  monthSpendUsd: number;
  budgetUsd: number;
}): Promise<
  | { ok: true; email: string; status: string; costUsd: number }
  | { ok: false; error: string; skipped?: boolean }
> {
  if (enrichmentKillSwitchEnabled()) {
    return { ok: false, error: 'kill_switch', skipped: true };
  }
  if (!flag('HUNTER_LIVE') || !hasKey('HUNTER_API_KEY')) {
    return { ok: false, error: 'hunter_not_live', skipped: true };
  }
  const estimate = PROVIDER_COST_USD.hunter_email;
  const gate = budgetAllowsSpend({
    monthSpendUsd: input.monthSpendUsd,
    estimateUsd: estimate,
    budgetUsd: input.budgetUsd,
  });
  if (!gate.ok) return { ok: false, error: gate.reason || 'budget', skipped: true };

  const parts = input.fullName.trim().split(/\s+/);
  const first = parts[0] || '';
  const last = parts.slice(1).join(' ') || '';
  const key = process.env.HUNTER_API_KEY!.trim();
  const url = new URL('https://api.hunter.io/v2/email-finder');
  url.searchParams.set('domain', input.domain);
  url.searchParams.set('first_name', first);
  url.searchParams.set('last_name', last);
  url.searchParams.set('api_key', key);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return { ok: false, error: `hunter_http_${res.status}` };
    const json = (await res.json()) as {
      data?: { email?: string; score?: number };
    };
    if (!json.data?.email) return { ok: false, error: 'hunter_empty' };
    return {
      ok: true,
      email: json.data.email,
      status: (json.data.score ?? 0) >= 70 ? 'valid' : 'unknown',
      costUsd: estimate,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'hunter_failed',
    };
  }
}

export async function zeroBounceVerify(email: string): Promise<
  | { ok: true; status: 'valid' | 'invalid' | 'catch_all' | 'unknown'; costUsd: number }
  | { ok: false; error: string; skipped?: boolean }
> {
  if (enrichmentKillSwitchEnabled()) {
    return { ok: false, error: 'kill_switch', skipped: true };
  }
  if (!flag('ZEROBOUNCE_LIVE') || !hasKey('ZEROBOUNCE_API_KEY')) {
    return { ok: false, error: 'zerobounce_not_live', skipped: true };
  }
  const key = process.env.ZEROBOUNCE_API_KEY!.trim();
  const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `zb_http_${res.status}` };
    const json = (await res.json()) as { status?: string };
    const s = (json.status || '').toLowerCase();
    const costUsd = PROVIDER_COST_USD.zerobounce;
    if (s === 'valid') return { ok: true, status: 'valid', costUsd };
    if (s === 'invalid') return { ok: true, status: 'invalid', costUsd };
    if (s === 'catch-all' || s === 'catch_all') {
      return { ok: true, status: 'catch_all', costUsd };
    }
    return { ok: true, status: 'unknown', costUsd };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'zb_failed',
    };
  }
}
