import { describe, expect, it } from 'vitest';
import {
  cadenceToMonthly,
  chargebackPctValid,
  computeMonthlyUsd,
  computeWasteMonthly,
  enrichVendor,
  renewalAlertStage,
} from '@/lib/vendor-mgmt/math';
import type { VmVendor } from '@/lib/vendor-mgmt/types';

describe('vendor monthly normalization', () => {
  it('Annual $1200 invoice → $100 monthly_usd', () => {
    expect(cadenceToMonthly(1200, 'Annual')).toBe(100);
    expect(
      computeMonthlyUsd({
        pricing_model: 'Fixed',
        billing_cadence: 'Annual',
        invoice_amount: 1200,
      }),
    ).toBe(100);
  });

  it('Per-user 10 seats × $15 → $150 monthly when unit_price set', () => {
    expect(
      computeMonthlyUsd({
        pricing_model: 'Per User',
        billing_cadence: 'Annual',
        invoice_amount: 9999,
        seats_active: 10,
        unit_price: 15,
      }),
    ).toBe(150);
  });

  it('falls back to invoice/cadence when seats/unit missing', () => {
    expect(
      computeMonthlyUsd({
        pricing_model: 'Per User',
        billing_cadence: 'Quarterly',
        invoice_amount: 300,
      }),
    ).toBe(100);
  });

  it('computes waste from contracted − active × unit', () => {
    expect(
      computeWasteMonthly({
        seats_contracted: 20,
        seats_active: 12,
        unit_price: 10,
      }),
    ).toBe(80);
  });
});

describe('renewal stages', () => {
  it('maps days_to_end to alert stages', () => {
    expect(renewalAlertStage(120)).toBe('OK');
    expect(renewalAlertStage(90)).toBe('90-DAY');
    expect(renewalAlertStage(45)).toBe('60-DAY');
    expect(renewalAlertStage(30)).toBe('30-DAY');
    expect(renewalAlertStage(-1)).toBe('EXPIRED');
  });

  it('enrichVendor sets 30-DAY for near expiry', () => {
    const vendor: VmVendor = {
      id: 'V1',
      name: 'Test',
      entity_id: 'ENT-R619',
      category: 'Productivity',
      product: 'X',
      pricing_model: 'Fixed',
      billing_cadence: 'Annual',
      invoice_amount: 1200,
      currency: 'USD',
      seats_contracted: null,
      seats_active: null,
      unit_price: null,
      contract_start: '2025-01-01',
      contract_end: '2026-03-20',
      auto_renew: false,
      status: 'Active',
      owner: null,
      notes: null,
      partner_key: null,
      cost_center_id: null,
      archived_at: null,
      created_at: '',
      updated_at: '',
    };
    const enriched = enrichVendor(vendor, { asOf: '2026-03-01' });
    expect(enriched.monthly_usd).toBe(100);
    expect(enriched.days_to_end).toBe(19);
    expect(enriched.renewal_stage).toBe('30-DAY');
  });
});

describe('chargeback', () => {
  it('Fixed % must sum to 100%', () => {
    expect(
      chargebackPctValid({
        method: 'Fixed %',
        pct_tage: 0.25,
        pct_r619: 0.25,
        pct_shr: 0.25,
        pct_inda: 0.25,
      }),
    ).toBe(true);
    expect(
      chargebackPctValid({
        method: 'Fixed %',
        pct_tage: 0.5,
        pct_r619: 0.25,
        pct_shr: 0.25,
        pct_inda: 0,
      }),
    ).toBe(true);
    expect(
      chargebackPctValid({
        method: 'Fixed %',
        pct_tage: 0.5,
        pct_r619: 0.5,
        pct_shr: 0.5,
        pct_inda: 0,
      }),
    ).toBe(false);
    expect(
      chargebackPctValid({
        method: 'Seats',
        pct_tage: 0,
        pct_r619: 0,
        pct_shr: 0,
        pct_inda: 0,
      }),
    ).toBe(true);
  });
});
