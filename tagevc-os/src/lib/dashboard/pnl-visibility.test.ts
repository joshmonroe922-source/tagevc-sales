import { describe, expect, it } from 'vitest';
import {
  canAccessPnlEntity,
  enforcePnlDashboardScope,
  enforcePnlFinanceEntity,
  filterCompanyOptionsForPnl,
  filterIesReportForPnlAccess,
  pnlVisibilityMatrixRow,
  resolvePnlScopeAccess,
} from './pnl-visibility';
import type { IesEntityFinanceRow, IesFinanceReport } from '@/lib/ies/report';
import { APP_ROLES, type AppRole } from '@/lib/types/roles';

const ENTITIES = [
  {
    entity_id: 'ENT-FIRM',
    coo_owner: null as string | null,
    parent_entity_id: null as string | null,
  },
  {
    entity_id: 'ENT-R619',
    coo_owner: 'COO — Ops Lead' as string | null,
    parent_entity_id: 'ENT-FIRM' as string | null,
  },
  {
    entity_id: 'ENT-INDA',
    coo_owner: 'COO — Ops Lead' as string | null,
    parent_entity_id: 'ENT-FIRM' as string | null,
  },
  {
    entity_id: 'ENT-SIGNENT',
    coo_owner: 'PM — Other' as string | null,
    parent_entity_id: 'ENT-FIRM' as string | null,
  },
];

const COMPANY_OPTS = [
  { entity_id: 'ENT-FIRM', name: 'Tage Venture Capital' },
  { entity_id: 'ENT-R619', name: 'Recruit 619' },
  { entity_id: 'ENT-INDA', name: 'Instant NDA' },
  { entity_id: 'ENT-SIGNENT', name: 'Signent HR' },
];

function stubReport(ids: string[]): IesFinanceReport {
  const companies: IesEntityFinanceRow[] = ids.map((entity_id) => ({
    entity_id,
    company_name: entity_id,
    realm_id: null,
    ies_company_name: null,
    mapped: true,
    feed_status: 'ok',
    cash_on_hand: 10,
    ar_balance: null,
    ap_balance: null,
    burn_rate_monthly: null,
    open_invoices: null,
    overdue_invoices: null,
    open_invoice_balance: null,
    coa_account_count: null,
    coa_by_type: {},
    as_of: '2026-07-01',
    last_sync_at: null,
    stale: false,
    revenue: 100,
    expenses: 40,
    net_income: 60,
    data_gaps: [],
    todo: null,
  }));
  return {
    configured: true,
    sync_enabled: true,
    write_enabled: false,
    missing_secrets: [],
    secrets_doc: [],
    connections: [],
    companies,
    consolidated: {
      cash_on_hand: 40,
      ar_balance: null,
      ap_balance: null,
      open_invoices: null,
      overdue_invoices: null,
      revenue: 400,
      expenses: 160,
      net_income: 240,
      as_of: '2026-07-01',
      feed_status: 'ok',
      note: 'full',
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
  };
}

describe('P&L visibility RBAC', () => {
  it('matrix: Visionary + Accounting/Finance = full firm', () => {
    for (const role of ['visionary', 'ssc_finance'] as AppRole[]) {
      const row = pnlVisibilityMatrixRow(role);
      expect(row).toMatchObject({
        live_pnl: true,
        consolidated: true,
        firm_strip: true,
        companies: 'all',
      });
      const access = resolvePnlScopeAccess({ role, entities: ENTITIES });
      expect(access.canViewConsolidated).toBe(true);
      expect(access.canViewFirmPerformance).toBe(true);
      expect(access.allowedEntityIds).toBe('all');
    }
  });

  it('matrix: Partner = subsidiaries + Tage VC + consolidated (no firm strip)', () => {
    const row = pnlVisibilityMatrixRow('partner');
    expect(row).toMatchObject({
      live_pnl: true,
      consolidated: true,
      firm_strip: false,
      companies: 'all',
    });
    const access = resolvePnlScopeAccess({
      role: 'partner',
      entities: ENTITIES,
    });
    expect(access.canViewConsolidated).toBe(true);
    expect(access.canViewFirmPerformance).toBe(false);
    expect(access.allowedEntityIds).toBe('all');
    expect(filterCompanyOptionsForPnl(COMPANY_OPTS, access)).toHaveLength(4);
  });

  it('matrix: COO = assigned entities only (coo_owner)', () => {
    const access = resolvePnlScopeAccess({
      role: 'coo',
      profileFullName: 'Josh Monroe',
      entities: ENTITIES,
    });
    expect(access.canViewConsolidated).toBe(false);
    expect(access.canViewFirmPerformance).toBe(false);
    expect(access.allowedEntityIds).toEqual(['ENT-R619', 'ENT-INDA']);
    expect(
      filterCompanyOptionsForPnl(COMPANY_OPTS, access).map((c) => c.entity_id),
    ).toEqual(['ENT-R619', 'ENT-INDA']);
    expect(canAccessPnlEntity(access, 'ENT-FIRM')).toBe(false);
    expect(canAccessPnlEntity(access, 'ENT-SIGNENT')).toBe(false);
  });

  it('matrix: Subsidiary Leader = led entity only', () => {
    const access = resolvePnlScopeAccess({
      role: 'sub_lead',
      profileEntityId: 'ENT-R619',
      entities: ENTITIES,
    });
    expect(access.canViewConsolidated).toBe(false);
    expect(access.allowedEntityIds).toEqual(['ENT-R619']);
    expect(canAccessPnlEntity(access, 'ENT-INDA')).toBe(false);
  });

  it('blocks URL bypass: COO cannot open consolidated or foreign entity', () => {
    const access = resolvePnlScopeAccess({
      role: 'coo',
      entities: ENTITIES,
    });
    const consol = enforcePnlDashboardScope({
      access,
      requestedScope: 'consolidated',
      requestedEntityId: null,
    });
    expect(consol.denied).toBe(true);
    expect(consol.scope).toBe('company');
    expect(consol.entityId).toBe('ENT-R619');

    const foreign = enforcePnlDashboardScope({
      access,
      requestedScope: 'company',
      requestedEntityId: 'ENT-FIRM',
    });
    expect(foreign.denied).toBe(true);
    expect(foreign.entityId).toBe('ENT-R619');
  });

  it('blocks URL bypass: sub_lead finance entity clamp', () => {
    const access = resolvePnlScopeAccess({
      role: 'sub_lead',
      profileEntityId: 'ENT-INDA',
      entities: ENTITIES,
    });
    const clamped = enforcePnlFinanceEntity({
      access,
      requestedEntityId: 'ENT-R619',
    });
    expect(clamped.denied).toBe(true);
    expect(clamped.entityId).toBe('ENT-INDA');
  });

  it('filters IES report companies for lead-scoped roles', () => {
    const access = resolvePnlScopeAccess({
      role: 'coo',
      entities: ENTITIES,
    });
    const filtered = filterIesReportForPnlAccess(
      stubReport(['ENT-FIRM', 'ENT-R619', 'ENT-INDA', 'ENT-SIGNENT']),
      access,
    );
    expect(filtered.companies.map((c) => c.entity_id)).toEqual([
      'ENT-R619',
      'ENT-INDA',
    ]);
    expect(filtered.consolidated.revenue).toBe(200);
  });

  it('documents full role → scopes matrix', () => {
    const matrix = APP_ROLES.map((role) => pnlVisibilityMatrixRow(role));
    const byRole = Object.fromEntries(matrix.map((r) => [r.role, r]));
    expect(byRole.visionary.companies).toBe('all');
    expect(byRole.ssc_finance.firm_strip).toBe(true);
    expect(byRole.partner.firm_strip).toBe(false);
    expect(byRole.coo.companies).toBe('assigned');
    expect(byRole.sub_lead.companies).toBe('led');
    expect(byRole.admin.live_pnl).toBe(false);
    expect(byRole.associate.live_pnl).toBe(false);
  });
});
