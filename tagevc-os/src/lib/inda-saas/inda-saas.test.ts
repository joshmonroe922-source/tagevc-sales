import { describe, expect, it } from 'vitest';
import {
  INDA_SAAS_KPI_DICTIONARY,
  INDA_COMPANY_NAME,
  kpiById,
} from '@/lib/inda-saas/dictionary';
import {
  SAAS_REPORTS,
  kpisForRole,
  resolveSaasReportRole,
} from '@/lib/inda-saas/roles';
import { MAIN_NAV, flattenNavItems } from '@/lib/nav';

describe('inda saas kpi (tage parent)', () => {
  it('ships canonical Instant NDA dictionary', () => {
    expect(INDA_COMPANY_NAME).toBe('Instant NDA');
    expect(kpiById('mrr')?.name).toBe('MRR');
    expect(INDA_SAAS_KPI_DICTIONARY.length).toBeGreaterThanOrEqual(40);
    expect(SAAS_REPORTS).toHaveLength(12);
    expect(kpisForRole('vc_leadership')).toContain('arr');
    expect(resolveSaasReportRole({ realRole: 'partner' })).toBe('partner');
  });

  it('keeps Instant NDA SaaS KPI dictionary without top-level nav (hub/entity path)', () => {
    const flat = flattenNavItems(MAIN_NAV);
    // Intentionally not a top-level MAIN_NAV item — reach via Instant NDA entity OS / hub.
    expect(flat.some((n) => n.href === '/inda-saas')).toBe(false);
    expect(MAIN_NAV.map((i) => i.label)).not.toContain('Instant NDA SaaS');
  });
});
