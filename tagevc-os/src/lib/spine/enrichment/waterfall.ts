/**
 * Provider waterfall ranks + kill-switch / budget gates (C5–C6).
 * Live HTTP only from worker process with provider keys.
 */

export type ProviderName =
  | 'cache'
  | 'apollo'
  | 'pdl'
  | 'hunter'
  | 'zerobounce'
  | 'website_meta';

export const COMPANY_WATERFALL: ProviderName[] = [
  'cache',
  'apollo',
  'pdl',
  'website_meta',
];

export const PERSON_WATERFALL: ProviderName[] = [
  'pdl',
  'apollo',
  'hunter',
  'zerobounce',
];

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
