/**
 * Provider waterfall ranks + kill-switch / budget gates (C5–C6).
 * Live HTTP only from worker process with provider keys.
 *
 * Budget-first priority (Josh 2026-08-03):
 *   1. email_signature — free / first-party (scaffold OK until scraper ships)
 *   2. website_meta — company + external public sites
 *   3. apollo — paid; always last when LIVE
 */

export type ProviderName =
  | 'cache'
  | 'email_signature'
  | 'website_meta'
  | 'hunter'
  | 'zerobounce'
  | 'pdl'
  | 'apollo';

/** Company enrich order — Apollo last. */
export const COMPANY_WATERFALL: ProviderName[] = [
  'cache',
  'email_signature',
  'website_meta',
  'apollo',
];

/** Person enrich order — free → cheap email → PDL → Apollo last. */
export const PERSON_WATERFALL: ProviderName[] = [
  'email_signature',
  'website_meta',
  'hunter',
  'zerobounce',
  'pdl',
  'apollo',
];

/** Stage names in budget-first order (Apollo last). */
export const BUDGET_FIRST_STAGES = [
  'email_signature',
  'website_meta',
  'apollo',
] as const;

/** Explicit budget-first tiers for docs + UI. */
export const BUDGET_FIRST_TIERS = [
  {
    tier: 1,
    label: 'Email signatures',
    providers: ['email_signature'] as const,
    cost: 'free',
  },
  {
    tier: 2,
    label: 'Company + external websites',
    providers: ['website_meta'] as const,
    cost: 'free',
  },
  {
    tier: 3,
    label: 'Apollo.ai (paid)',
    providers: ['apollo'] as const,
    cost: 'paid',
  },
] as const;

export function providerWaterfallIndex(
  waterfall: readonly ProviderName[],
  provider: ProviderName,
): number {
  const i = waterfall.indexOf(provider);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

/** Lower = earlier in budget-first person waterfall (Apollo highest / last). */
export function providerRank(provider: ProviderName): number {
  return providerWaterfallIndex(PERSON_WATERFALL, provider);
}

/**
 * Email-signature scrape scaffold (backlog). Always skipped until mailbox AI ships.
 * Kept here so bootstrap/worker can import without path alias issues.
 */
export function scrapeEmailSignatureScaffold(_input?: {
  accountId?: string;
  contactId?: string;
  email?: string | null;
}): { ok: false; skipped: true; error: string } {
  return {
    ok: false,
    skipped: true,
    error: 'email_signature_scaffold_backlog',
  };
}

/** Free public website title/meta — budget-first tier 2. */
export async function fetchWebsiteMeta(
  domainOrUrl: string,
): Promise<{ ok: true; title: string | null } | { ok: false; title: null }> {
  const raw = (domainOrUrl || '').trim();
  if (!raw) return { ok: false, title: null };
  const url = raw.startsWith('http')
    ? raw
    : `https://${raw.replace(/^www\./, '')}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'TageOS-Enrichment/1.0' },
    });
    if (!res.ok) return { ok: false, title: null };
    const html = (await res.text()).slice(0, 80_000);
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = m?.[1]?.trim().slice(0, 200) || null;
    return title ? { ok: true, title } : { ok: false, title: null };
  } catch {
    return { ok: false, title: null };
  }
}

export function enrichmentKillSwitchEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = (env.ENRICHMENT_KILL_SWITCH || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

export function budgetAllowsSpend(input: {
  monthSpendUsd: number;
  estimateUsd: number;
  budgetUsd: number;
}): { ok: boolean; reason?: string } {
  if (input.budgetUsd <= 0) {
    return { ok: false, reason: 'budget_zero' };
  }
  if (input.monthSpendUsd + input.estimateUsd > input.budgetUsd) {
    return { ok: false, reason: 'budget_exceeded' };
  }
  return { ok: true };
}

export type MockCompanyEnrich = {
  name: string;
  domain: string;
  industry: string | null;
  employee_count: number | null;
  apollo_org_id: string | null;
  provider: ProviderName;
};

/** Offline/mock company enrich for worker skeleton demos. */
export function mockEnrichCompany(domain: string): MockCompanyEnrich {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return {
    name: d.split('.')[0]?.replace(/-/g, ' ') || d,
    domain: d,
    industry: 'Technology',
    employee_count: 50,
    apollo_org_id: null,
    provider: 'cache',
  };
}

export type MockPersonEnrich = {
  full_name: string;
  title: string | null;
  email: string | null;
  email_status: 'valid' | 'unknown';
  provider: ProviderName;
};

export function mockExpandPeople(input: {
  domain: string;
  patterns: string[];
  cap: number;
}): MockPersonEnrich[] {
  const base = input.domain.split('.')[0] || 'acme';
  const titles = input.patterns.slice(0, Math.max(1, input.cap));
  return titles.map((title, i) => ({
    full_name: `${title.split(' ')[0] || 'Lead'} ${base} ${i + 1}`,
    title,
    email: null,
    email_status: 'unknown' as const,
    provider: 'cache' as const,
  }));
}
