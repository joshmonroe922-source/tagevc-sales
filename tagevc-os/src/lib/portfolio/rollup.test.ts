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
    // Sample Closed Co (120/45/14/630) + Instant NDA (480/30/18/540) + R619 zeros
    expect(rollup.portfolio_arr_k).toBe(600);
    expect(rollup.portfolio_net_burn_k).toBe(75);
    expect(rollup.portfolio_cash_k).toBe(1170);
    expect(rollup.min_runway_mo).toBe(14);
    expect(rollup.firm_cash_k).toBe(800);
    expect(rollup.consolidated_cash_k).toBe(1970);
    expect(rollup.active_company_count).toBe(3);
    // Sample + Instant NDA COGS → (600-115)/600 = 80.833%
    expect(rollup.portfolio_gross_margin).toBeCloseTo(0.8083, 3);
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
    // Instant NDA 480/30/18/540 + Recruit 619 zeros — no Sample Closed Co
    expect(rollup.portfolio_arr_k).toBe(480);
    expect(rollup.portfolio_net_burn_k).toBe(30);
    expect(rollup.portfolio_cash_k).toBe(540);
    expect(rollup.min_runway_mo).toBe(18);
    expect(rollup.runway_breach).toBe(false);
    expect(rollup.active_company_count).toBe(2);
    // Instant NDA only: (480-90)/480 = 81.25%
    expect(rollup.portfolio_gross_margin).toBeCloseTo(0.8125, 4);
    // Firm seed $800k must not inflate consolidated when IES is disconnected
    expect(rollup.firm_cash_k).toBeNull();
    expect(rollup.consolidated_cash_k).toBeNull();
  });
});
