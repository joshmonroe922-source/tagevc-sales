import { describe, expect, it } from 'vitest';
import { buildCapitalPulseFromIes } from './capital-pulse';
import type { IesEntityFinanceRow, IesFinanceReport } from '@/lib/ies/report';

function row(
  overrides: Partial<IesEntityFinanceRow> & { entity_id: string },
): IesEntityFinanceRow {
  return {
    company_name: overrides.entity_id,
    realm_id: null,
    ies_company_name: null,
    mapped: true,
    feed_status: 'ok',
    cash_on_hand: null,
    ar_balance: null,
    ap_balance: null,
    burn_rate_monthly: null,
    open_invoices: null,
    overdue_invoices: null,
    open_invoice_balance: null,
    coa_account_count: null,
    coa_by_type: {},
    as_of: '2026-07-01',
    last_sync_at: '2026-07-01T12:00:00.000Z',
    stale: false,
    revenue: null,
    expenses: null,
    net_income: null,
    data_gaps: [],
    todo: null,
    ...overrides,
  };
}

function report(
  companies: IesEntityFinanceRow[],
  overrides: Partial<IesFinanceReport> = {},
): IesFinanceReport {
  return {
    configured: true,
    sync_enabled: true,
    write_enabled: false,
    missing_secrets: [],
    secrets_doc: [],
    connections: [{ display_name: 'Firm', status: 'active', environment: 'production', token_expires_at: null, connected_at: null }],
    companies,
    consolidated: {
      cash_on_hand: null,
      ar_balance: null,
      ap_balance: null,
      open_invoices: null,
      overdue_invoices: null,
      revenue: null,
      expenses: null,
      net_income: null,
      as_of: '2026-07-01',
      feed_status: 'ok',
      note: '',
      management_consolidation: true,
      data_gaps: [],
    },
    last_sync: null,
    ssc_close_href: '/shared-services/checklists',
    month_end_checklist_href: '/shared-services/finance',
    contract_version: 'phase70-v1',
    money_auto_approve: false,
    ies_write_executed: false,
    ies_system_of_record: true,
    ...overrides,
  };
}

describe('buildCapitalPulseFromIes', () => {
  it('returns Not connected when report missing or no live feeds', () => {
    expect(buildCapitalPulseFromIes(null).source).toBe('not_connected');
    expect(buildCapitalPulseFromIes(null).portfolio_arr_k).toBeNull();
    expect(buildCapitalPulseFromIes(null).firm_cash_k).toBeNull();

    const empty = buildCapitalPulseFromIes(
      report([
        row({ entity_id: 'ENT-R619', feed_status: 'missing' }),
      ]),
    );
    expect(empty.source).toBe('not_connected');
    expect(empty.portfolio_cash_k).toBeNull();
    expect(empty.source_label).toMatch(/Not connected/i);
  });

  it('sums firm vs portfolio cash from IES dollars into $k', () => {
    const pulse = buildCapitalPulseFromIes(
      report([
        row({ entity_id: 'ENT-FIRM', cash_on_hand: 800_000 }),
        row({
          entity_id: 'ENT-R619',
          cash_on_hand: 120_000,
          burn_rate_monthly: 10_000,
        }),
        row({
          entity_id: 'ENT-INDA',
          cash_on_hand: 50_000,
          burn_rate_monthly: 5_000,
        }),
      ]),
    );
    expect(pulse.source).toBe('ies');
    expect(pulse.firm_cash_k).toBe(800);
    expect(pulse.portfolio_cash_k).toBe(170);
    expect(pulse.consolidated_cash_k).toBe(970);
    expect(pulse.portfolio_net_burn_k).toBe(15);
    // ARR / margin stay honest-empty (not on IES feed)
    expect(pulse.portfolio_arr_k).toBeNull();
    expect(pulse.portfolio_gross_margin).toBeNull();
    // R619 runway 12 mo, INDA 10 mo → min 10, breach
    expect(pulse.min_runway_mo).toBe(10);
    expect(pulse.runway_breach).toBe(true);
  });

  it('ignores sample entity ids and missing feeds', () => {
    const pulse = buildCapitalPulseFromIes(
      report([
        row({
          entity_id: 'ENT-001',
          cash_on_hand: 999_999,
          feed_status: 'missing',
        }),
        row({ entity_id: 'ENT-FIRM', cash_on_hand: 100_000 }),
        row({ entity_id: 'ENT-R619', cash_on_hand: 40_000 }),
      ]),
    );
    expect(pulse.firm_cash_k).toBe(100);
    expect(pulse.portfolio_cash_k).toBe(40);
    expect(pulse.consolidated_cash_k).toBe(140);
  });
});
