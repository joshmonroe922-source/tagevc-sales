/**
 * Provider waterfall ranks + kill-switch / budget gates (C5–C6).
 * Live HTTP only from worker process with provider keys.
 *
 * Budget-first priority (Josh 2026-08-03):
 *   1. email signatures (free / backlog scaffold)
 *   2. company + external websites (free public fetch)
 *   3. paid providers — Apollo.ai last when LIVE
 */

export type ProviderName =
  | 'cache'
  | 'email_signature'
  | 'website_meta'
  | 'hunter'
  | 'zerobounce'
  | 'pdl'
  | 'apollo';

/** Human-readable budget-first stages (docs + UI). */
export const BUDGET_FIRST_STAGES = [
  'email_signature',
  'website_meta',
  'paid_providers_apollo_last',
] as const;

/**
 * Company enrich rank — free/cache first, Apollo last among paid.
 * `email_signature` is scaffold/backlog until mailbox mining ships.
 */
export const COMPANY_WATERFALL: ProviderName[] = [
  'cache',
  'email_signature',
  'website_meta',
  'pdl',
  'apollo',
];

/**
 * Person enrich rank — free first, Apollo last when LIVE.
 * Signature scrape is scaffold (trace-only) until built.
 */
export const PERSON_WATERFALL: ProviderName[] = [
  'email_signature',
  'website_meta',
  'hunter',
  'zerobounce',
  'pdl',
  'apollo',
];

/** Lower = earlier in waterfall. Apollo is always last among named providers. */
export function providerRank(
  provider: ProviderName,
  waterfall: readonly ProviderName[] = PERSON_WATERFALL,
): number {
  const i = waterfall.indexOf(provider);
  return i === -1 ? waterfall.length + 1 : i;
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

/**
 * Free website meta fetch (company stage 2). Public HTML title only — no auth scrape.
 */
export async function fetchWebsiteMeta(domain: string): Promise<{
  ok: boolean;
  title: string | null;
  provider: 'website_meta';
}> {
  const d = domain.toLowerCase().replace(/^www\./, '').trim();
  if (!d || d === 'example.com') {
    return { ok: false, title: null, provider: 'website_meta' };
  }
  const url = `https://${d}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'TageOS-Enrichment/1.0' },
    });
    if (!res.ok) return { ok: false, title: null, provider: 'website_meta' };
    const html = (await res.text()).slice(0, 80_000);
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = m?.[1]?.trim().slice(0, 200) || null;
    return { ok: Boolean(title), title, provider: 'website_meta' };
  } catch {
    return { ok: false, title: null, provider: 'website_meta' };
  }
}

/**
 * Email-signature contact mining — scaffold/backlog.
 * Always no-op until mailbox AI extraction ships (see platform-email policy).
 */
export function scrapeEmailSignatureScaffold(_input?: {
  contactId?: string;
  accountId?: string;
}): {
  ok: false;
  skipped: true;
  error: 'email_signature_backlog';
  provider: 'email_signature';
} {
  return {
    ok: false,
    skipped: true,
    error: 'email_signature_backlog',
    provider: 'email_signature',
  };
}
