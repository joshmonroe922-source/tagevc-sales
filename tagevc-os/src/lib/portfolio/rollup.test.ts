import { describe, expect, it } from 'vitest';
import {
  SEED_ENTITY_MONTH_PNL,
  SEED_PERIOD,
  SEED_PORTFOLIO_COMPANIES,
} from '@/lib/data/seed';
import { isHiddenActiveCompany } from '@/lib/entities/registry-visibility';
import { computePortfolioRollup } from './rollup';

describe('computePortfolioRollup', () => {
  it('inflates ARR/burn/runway/cash when sample companies are included', () => {
    const rollup = computePortfolioRollup({
      period: SEED_PERIOD,
      companies: SEED_PORTFOLIO_COMPANIES,
      pnlRows: SEED_ENTITY_MONTH_PNL,
      liveFirmCashK: 800,
    });
    // Sample Closed Co (120/45/14/630) + Instant NDA zeros + R619 zeros
    expect(rollup.portfolio_arr_k).toBe(120);
    expect(rollup.portfolio_net_burn_k).toBe(45);
    expect(rollup.portfolio_cash_k).toBe(630);
    expect(rollup.min_runway_mo).toBe(14);
    expect(rollup.firm_cash_k).toBe(800);
    expect(rollup.consolidated_cash_k).toBe(1430);
    expect(rollup.active_company_count).toBe(3);
    // Sample Closed Co only: (120-25)/120 = 79.167%
    expect(rollup.portfolio_gross_margin).toBeCloseTo(0.7917, 3);
  });

  it('matches visible Active companies after hiding samples', () => {
    const companies = SEED_PORTFOLIO_COMPANIES.filter(
      (c) => !isHiddenActiveCompany(c),
    );
    const visibleIds = new Set(companies.map((c) => c.entity_id));
    const pnlRows = SEED_ENTITY_MONTH_PNL.filter(
      (r) => r.is_firm || visibleIds.has(r.entity_id),
    );
    const rollup = computePortfolioRollup({
      period: SEED_PERIOD,
      companies,
      pnlRows,
      liveFirmCashK: null,
    });
    // Instant NDA + Recruit 619 both zeroed — no Sample Closed Co
    expect(rollup.portfolio_arr_k).toBe(0);
    expect(rollup.portfolio_net_burn_k).toBe(0);
    expect(rollup.portfolio_cash_k).toBe(0);
    expect(rollup.min_runway_mo).toBeNull();
    expect(rollup.runway_breach).toBe(false);
    expect(rollup.active_company_count).toBe(2);
    expect(rollup.portfolio_gross_margin).toBeNull();
    // Firm seed $800k must not inflate consolidated when IES is disconnected
    expect(rollup.firm_cash_k).toBeNull();
    expect(rollup.consolidated_cash_k).toBeNull();
  });
});
