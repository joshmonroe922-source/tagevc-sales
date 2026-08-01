import { describe, expect, it } from 'vitest';

import {
  allocateChargebackFixed,
  allocateChargebackSeats,
  chargebackValid,
  computeHireCost,
  computeVendorSpend,
  invoiceMonthlyUsd,
  renewalStage,
} from '@/lib/vendor-mgmt/normalize';
import {
  applyOffboardRevoke,
  planEntitlementsForHire,
} from '@/lib/vendor-mgmt/normalize';

describe('vendor spend normalization', () => {
  it('Annual $1200 invoice → $100 monthly_usd', () => {
    expect(invoiceMonthlyUsd(1200, 'Annual')).toBe(100);
    const spend = computeVendorSpend({
      pricing_model: 'Fixed',
      billing_cadence: 'Annual',
      invoice_amount: 1200,
    });
    expect(spend.monthly_usd).toBe(100);
    expect(spend.annual_usd).toBe(1200);
  });

  it('Per-user 10 seats × $15 → $150 monthly when unit_price set', () => {
    const spend = computeVendorSpend({
      pricing_model: 'Per User',
      billing_cadence: 'Annual',
      invoice_amount: 9999,
      seats_active: 10,
      seats_contracted: 12,
      unit_price: 15,
    });
    expect(spend.monthly_usd).toBe(150);
    expect(spend.waste_monthly).toBe(30);
    expect(spend.utilization_pct).toBeCloseTo(83.3, 0);
  });

  it('Quarterly and semi-annual divisors', () => {
    expect(invoiceMonthlyUsd(300, 'Quarterly')).toBe(100);
    expect(invoiceMonthlyUsd(600, 'Semi-Annual')).toBe(100);
  });
});

describe('renewal stages', () => {
  it('flags 30-day and expired windows', () => {
    const asOf = '2026-03-01';
    expect(renewalStage('2026-03-20', asOf).stage).toBe('30-DAY');
    expect(renewalStage('2026-04-15', asOf).stage).toBe('60-DAY');
    expect(renewalStage('2026-05-20', asOf).stage).toBe('90-DAY');
    expect(renewalStage('2026-02-01', asOf).stage).toBe('EXPIRED');
    expect(renewalStage('2027-01-01', asOf).stage).toBe('OK');
  });
});

describe('chargeback', () => {
  it('Fixed % must sum to 100%', () => {
    expect(chargebackValid([0.25, 0.25, 0.25, 0.25], 'Fixed %')).toBe(true);
    expect(chargebackValid([0.5, 0.5, 0, 0.1], 'Fixed %')).toBe(false);
    expect(chargebackValid([0, 0, 0, 0], 'Seats')).toBe(true);
  });

  it('allocates by seats headcount share', () => {
    const alloc = allocateChargebackSeats(1000, {
      'ENT-FIRM': 1,
      'ENT-R619': 3,
      'ENT-SIGNENT': 0,
      'ENT-INDA': 0,
    });
    expect(alloc['ENT-FIRM']).toBe(250);
    expect(alloc['ENT-R619']).toBe(750);
  });

  it('allocates fixed percents', () => {
    const alloc = allocateChargebackFixed(1000, {
      TAGE: 0.4,
      R619: 0.2,
      SHR: 0.2,
      INDA: 0.2,
    });
    expect(alloc.TAGE).toBe(400);
    expect(alloc.R619).toBe(200);
  });
});

describe('offboard revoke', () => {
  it('Terminated employee — licenses reclaim', () => {
    const result = applyOffboardRevoke({
      entitlements: [
        {
          emp_id: 'E1',
          product_id: 'P-M365',
          assigned: true,
          source: 'birthright',
          assigned_at: '2026-01-01',
          revoked_at: null,
        },
        {
          emp_id: 'E1',
          product_id: 'P-ORG',
          assigned: true,
          source: 'birthright',
          assigned_at: '2026-01-01',
          revoked_at: null,
        },
      ],
      products: [
        { id: 'P-M365', offboard_action: 'Revoke' },
        { id: 'P-ORG', offboard_action: 'Keep org' },
      ],
      hasLinkedAdmin: true,
    });
    expect(result.entitlements.every((e) => e.assigned === false)).toBe(true);
    expect(result.revokedProductIds).toContain('P-M365');
    expect(result.keepOrgProductIds).toContain('P-ORG');
    expect(result.deactivateAdmin).toBe(true);
  });

  it('hire assigns birthright products', () => {
    const planned = planEntitlementsForHire({
      empId: 'E2',
      roleId: 'R-AE',
      roleProducts: [
        { role_id: 'R-AE', product_id: 'P-M365', is_birthright: true },
        { role_id: 'R-AE', product_id: 'P-SLACK', is_birthright: true },
        { role_id: 'R-AE', product_id: 'P-AWS', is_birthright: false },
      ],
    });
    expect(planned).toHaveLength(2);
    expect(planned.every((p) => p.assigned && p.source === 'birthright')).toBe(
      true,
    );
  });
});

describe('hire simulator', () => {
  it('computes Y1 fully loaded from inputs', () => {
    const r = computeHireCost({
      baseSalaryAnnual: 100_000,
      commissionTargetAnnual: 0,
      techLicMonthly: 50,
      burdenPct: 0.28,
      benefitsMonthly: 450,
      recruitingPct: 0.15,
      equipmentOnetime: 2500,
      training90d: 1500,
      facilitiesMonthly: 200,
      mgmtOverheadPct: 0.08,
    });
    expect(r.recruiting_onetime).toBe(15_000);
    expect(r.onetime_total).toBe(19_000);
    expect(r.monthly_run_rate).toBeGreaterThan(0);
    expect(r.y1_total).toBeGreaterThan(r.monthly_run_rate * 12);
  });
});
