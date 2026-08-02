/**
 * Live-ready enrichment providers — fail closed without keys / LIVE flags.
 * Never invent API keys. Worker calls these; Next.js must not.
 */

import {
  budgetAllowsSpend,
  enrichmentKillSwitchEnabled,
  type ProviderName,
} from '@/lib/spine/enrichment/waterfall';

export type ProviderHealth = {
  provider: ProviderName | 'apollo' | 'pdl' | 'hunter' | 'zerobounce';
  configured: boolean;
  liveEnabled: boolean;
  ready: boolean;
  note: string;
};

function flag(name: string): boolean {
  const v = (process.env[name] || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

function hasKey(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export function getEnrichmentProviderHealth(): ProviderHealth[] {
  const kill = enrichmentKillSwitchEnabled();
  const rows: Array<Omit<ProviderHealth, 'ready' | 'note'> & { note: string }> =
    [
      {
        provider: 'apollo',
        configured: hasKey('APOLLO_API_KEY'),
        liveEnabled: flag('APOLLO_LIVE'),
        note: 'Company + people search',
      },
      {
        provider: 'pdl',
        configured: hasKey('PDL_API_KEY'),
        liveEnabled: flag('PDL_LIVE'),
        note: 'Person enrich waterfall',
      },
      {
        provider: 'hunter',
        configured: hasKey('HUNTER_API_KEY'),
        liveEnabled: flag('HUNTER_LIVE'),
        note: 'Email finder',
      },
      {
        provider: 'zerobounce',
        configured: hasKey('ZEROBOUNCE_API_KEY'),
        liveEnabled: flag('ZEROBOUNCE_LIVE'),
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

export type ApolloOrgResult = {
  provider: 'apollo';
  name: string;
  domain: string;
  industry: string | null;
  employee_count: number | null;
  apollo_org_id: string | null;
  raw?: unknown;
};

export async function apolloEnrichCompany(input: {
  domain: string;
  monthSpendUsd: number;
  budgetUsd: number;
  estimateUsd?: number;
}): Promise<
  | { ok: true; data: ApolloOrgResult }
  | { ok: false; error: string; skipped?: boolean }
> {
  if (enrichmentKillSwitchEnabled()) {
    return { ok: false, error: 'kill_switch', skipped: true };
  }
  if (!flag('APOLLO_LIVE') || !hasKey('APOLLO_API_KEY')) {
    return { ok: false, error: 'apollo_not_live', skipped: true };
  }
  const gate = budgetAllowsSpend({
    monthSpendUsd: input.monthSpendUsd,
    estimateUsd: input.estimateUsd ?? 0.05,
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

export async function hunterFindEmail(input: {
  domain: string;
  fullName: string;
  monthSpendUsd: number;
  budgetUsd: number;
}): Promise<
  | { ok: true; email: string; status: string }
  | { ok: false; error: string; skipped?: boolean }
> {
  if (enrichmentKillSwitchEnabled()) {
    return { ok: false, error: 'kill_switch', skipped: true };
  }
  if (!flag('HUNTER_LIVE') || !hasKey('HUNTER_API_KEY')) {
    return { ok: false, error: 'hunter_not_live', skipped: true };
  }
  const gate = budgetAllowsSpend({
    monthSpendUsd: input.monthSpendUsd,
    estimateUsd: 0.02,
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
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'hunter_failed',
    };
  }
}

export async function zeroBounceVerify(email: string): Promise<
  | { ok: true; status: 'valid' | 'invalid' | 'catch_all' | 'unknown' }
  | { ok: false; error: string; skipped?: boolean }
> {
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
    if (s === 'valid') return { ok: true, status: 'valid' };
    if (s === 'invalid') return { ok: true, status: 'invalid' };
    if (s === 'catch-all' || s === 'catch_all') {
      return { ok: true, status: 'catch_all' };
    }
    return { ok: true, status: 'unknown' };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'zb_failed',
    };
  }
}
