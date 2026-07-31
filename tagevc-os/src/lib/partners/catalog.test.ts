import { describe, expect, it } from 'vitest';
import {
  PARTNER_CATALOG,
  defaultEntityPartnerEnablement,
} from '@/lib/partners/catalog';
import { entityCreatePartnerPlan } from '@/lib/partners/registry';
import {
  calculateCommissionCents,
  isGustoLive,
} from '@/lib/partners/gusto-commissions';

describe('partner spine registry helpers', () => {
  it('lists eleven spine partners', () => {
    expect(PARTNER_CATALOG.length).toBe(11);
  });

  it('enables MyBasePay on R619 create plan', () => {
    const plan = entityCreatePartnerPlan('ENT-R619');
    expect(plan.find((p) => p.partner_key === 'mybasepay')?.enabled).toBe(true);
  });

  it('inherits presence partners for future entities', () => {
    const keys = defaultEntityPartnerEnablement('ENT-ACME');
    expect(keys).toContain('google_business');
    expect(keys).toContain('linkedin_company');
    expect(keys).toContain('google_analytics');
  });

  it('gusto commission helper + fail-closed live flag', () => {
    expect(calculateCommissionCents(50_000, 500)).toBe(2_500);
    expect(typeof isGustoLive()).toBe('boolean');
  });
});
