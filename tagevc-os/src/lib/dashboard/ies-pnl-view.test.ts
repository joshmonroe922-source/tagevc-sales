import { describe, expect, it } from 'vitest';
import {
  buildDashboardPnlView,
  buildTageVcFirmPerformance,
  canViewTageVcFirmPerformance,
  formatPnlMetric,
} from './ies-pnl-view';
import type { IesEntityFinanceRow, IesFinanceReport } from '@/lib/ies/report';

function row(
  patch: Partial<IesEntityFinanceRow> & { entity_id: string },
): IesEntityFinanceRow {
  return {
    entity_id: patch.entity_id,
    company_name: patch.company_name ?? patch.entity_id,
    realm_id: null,
    ies_company_name: null,
    mapped: true,
    feed_status: patch.feed_status ?? 'ok',
    cash_on_hand: patch.cash_on_hand ?? null,
    ar_balance: patch.ar_balance ?? null,
    ap_balance: patch.ap_balance ?? null,
    burn_rate_monthly: null,
    open_invoices: null,
    overdue_invoices: null,
    open_invoice_balance: null,
    coa_account_count: null,
    coa_by_type: {},
    as_of: patch.as_of ?? '2026-07-01',
    last_sync_at: null,
    stale: patch.stale ?? false,
    revenue: patch.revenue ?? null,
    expenses: patch.expenses ?? null,
    net_income: patch.net_income ?? null,
    data_gaps: patch.data_gaps ?? [],
    todo: patch.todo ?? null,
  };
}

function report(companies: IesEntityFinanceRow[]): IesFinanceReport {
  const sum = (pick: (r: IesEntityFinanceRow) => number | null) => {
    let t = 0;
    let any = false;
    for (const r of companies) {
      const v = pick(r);
      if (v != null) {
        t += v;
        any = true;
      }
    }
    return any ? t : null;
  };
  return {
    configured: true,
    sync_enabled: true,
    write_enabled: false,
    missing_secrets: [],
    secrets_doc: [],
    connections: [
      {
        display_name: 'Tage Venture Capital',
        status: 'connected',
        environment: 'production',
        token_expires_at: null,
        connected_at: '2026-07-01',
      },
    ],
    companies,
    consolidated: {
      cash_on_hand: sum((r) => r.cash_on_hand),
      ar_balance: sum((r) => r.ar_balance),
      ap_balance: sum((r) => r.ap_balance),
      open_invoices: null,
      overdue_invoices: null,
      revenue: sum((r) => r.revenue),
      expenses: sum((r) => r.expenses),
      net_income: sum((r) => r.net_income),
      as_of: '2026-07-01',
      feed_status: 'ok',
      note: 'Management consolidation — eliminations not applied',
      management_consolidation: true,
      data_gaps: [],
    },
    last_sync: null,
    ssc_close_href: '/shared-services/checklists',
    month_end_checklist_href: '/shared-services/af/finance',
    contract_version: 'phase70-v1',
    money_auto_approve: false,
    ies_write_executed: false,
    ies_system_of_record: true,
  };
}

describe('Dashboard IES P&L view', () => {
  it('builds consolidated native P&L from synced companies', () => {
    const view = buildDashboardPnlView({
      report: report([
        row({
          entity_id: 'ENT-FIRM',
          company_name: 'Tage Venture Capital',
          cash_on_hand: 100_000,
          revenue: 10_000,
          expenses: 8_000,
          net_income: 2_000,
        }),
        row({
          entity_id: 'ENT-R619',
          company_name: 'Recruit 619',
          cash_on_hand: 50_000,
          revenue: 40_000,
          expenses: 30_000,
          net_income: 10_000,
        }),
      ]),
      scope: 'consolidated',
    });
    expect(view.display_mode).toBe('native_ies_sync');
    expect(view.scope).toBe('consolidated');
    expect(view.revenue).toBe(50_000);
    expect(view.net_income).toBe(12_000);
    expect(view.state).toBe('live');
  });

  it('scopes company P&L to selected entity', () => {
    const view = buildDashboardPnlView({
      report: report([
        row({
          entity_id: 'ENT-R619',
          company_name: 'Recruit 619',
          revenue: 40_000,
          expenses: 30_000,
          net_income: 10_000,
          cash_on_hand: 50_000,
        }),
      ]),
      scope: 'company',
      entityId: 'ENT-R619',
    });
    expect(view.entity_id).toBe('ENT-R619');
    expect(view.revenue).toBe(40_000);
    expect(view.title).toContain('Recruit 619');
  });

  it('shows Not Connected when IES missing — never invents numbers', () => {
    expect(formatPnlMetric(null)).toBe('Not Connected');
    const view = buildDashboardPnlView({
      report: null,
      scope: 'consolidated',
    });
    expect(view.state).toBe('not_connected');
    expect(view.revenue).toBeNull();
    expect(view.net_income).toBeNull();
  });

  it('builds Tage VC firm performance for parent entity', () => {
    const firm = buildTageVcFirmPerformance(
      report([
        row({
          entity_id: 'ENT-FIRM',
          company_name: 'Tage Venture Capital',
          cash_on_hand: 800_000,
          revenue: 5_000,
          expenses: 12_000,
          net_income: -7_000,
        }),
      ]),
    );
    expect(firm.entity_id).toBe('ENT-FIRM');
    expect(firm.is_parent).toBe(true);
    expect(firm.cash_on_hand).toBe(800_000);
    expect(firm.title).toMatch(/Tage Venture Capital/);
  });

  it('gates firm performance to Visionary and Accounting / Finance', () => {
    expect(canViewTageVcFirmPerformance('visionary')).toBe(true);
    expect(canViewTageVcFirmPerformance('ssc_finance')).toBe(true);
    expect(canViewTageVcFirmPerformance('coo')).toBe(false);
    expect(canViewTageVcFirmPerformance('admin')).toBe(false);
  });
});
