/**
 * Dashboard live P&L view from IES sync snapshots.
 * Native OS display is primary — Intuit does not reliably iframe-embed P&L;
 * use Open in IES deep links. Never invent sample numbers.
 */

import { entityDisplayName } from '@/lib/entities/display-name';
import type { IesEntityFinanceRow, IesFinanceReport } from '@/lib/ies/report';
import type { DashboardScopeMode } from '@/lib/dashboard/role-dashboard-catalog';
import { iesOpenInBooksHref, IES_EMBED_POLICY } from '@/lib/ies/ux';
import type { AppRole } from '@/lib/types/roles';

export type DashboardPnlMetricState = 'live' | 'partial' | 'not_connected';

export type DashboardPnlView = {
  /** consolidated | company entity id */
  scope: 'consolidated' | 'company';
  entity_id: string | null;
  title: string;
  subtitle: string;
  state: DashboardPnlMetricState;
  as_of: string | null;
  stale: boolean;
  revenue: number | null;
  expenses: number | null;
  net_income: number | null;
  cash_on_hand: number | null;
  ar_balance: number | null;
  ap_balance: number | null;
  feed_status: IesEntityFinanceRow['feed_status'] | 'missing';
  note: string;
  data_gaps: string[];
  /** Always ies_sync — UI never embeds Intuit. */
  display_mode: 'native_ies_sync';
  finance_href: string;
  /** Best-effort QBO/IES P&L deep link (not an embed). */
  open_in_ies_href: string | null;
  /** Last sync run or company as_of for Refresh stamp. */
  last_synced_at: string | null;
  embed_policy: typeof IES_EMBED_POLICY;
};

export type FirmPerformanceView = DashboardPnlView & {
  entity_id: 'ENT-FIRM';
  is_parent: true;
};

const FIRM_PERF_ROLES: readonly AppRole[] = [
  'visionary',
  'think_tank',
  'ssc_finance',
];

export function canViewTageVcFirmPerformance(role: AppRole): boolean {
  return FIRM_PERF_ROLES.includes(role);
}

function hasAnyPnl(row: {
  revenue: number | null;
  expenses: number | null;
  net_income: number | null;
  cash_on_hand: number | null;
}): boolean {
  return (
    row.revenue != null ||
    row.expenses != null ||
    row.net_income != null ||
    row.cash_on_hand != null
  );
}

function stateFromRow(
  report: IesFinanceReport,
  connected: boolean,
  partial: boolean,
): DashboardPnlMetricState {
  if (!report.configured || report.connections.length === 0 || !connected) {
    return 'not_connected';
  }
  return partial ? 'partial' : 'live';
}

function emptyView(args: {
  scope: 'consolidated' | 'company';
  entity_id: string | null;
  title: string;
  note: string;
  finance_href: string;
  last_synced_at?: string | null;
}): DashboardPnlView {
  return {
    scope: args.scope,
    entity_id: args.entity_id,
    title: args.title,
    subtitle: 'IES books · native sync',
    state: 'not_connected',
    as_of: null,
    stale: true,
    revenue: null,
    expenses: null,
    net_income: null,
    cash_on_hand: null,
    ar_balance: null,
    ap_balance: null,
    feed_status: 'missing',
    note: args.note,
    data_gaps: ['No IES P&L snapshot synced'],
    display_mode: 'native_ies_sync',
    finance_href: args.finance_href,
    open_in_ies_href: iesOpenInBooksHref(args.entity_id),
    last_synced_at: args.last_synced_at ?? null,
    embed_policy: IES_EMBED_POLICY,
  };
}

/**
 * Build P&L view for Dashboard company filter (consolidated or one entity).
 * Prefer full unfiltered report so consolidated always sums all companies.
 */
export function buildDashboardPnlView(opts: {
  report: IesFinanceReport | null | undefined;
  scope: DashboardScopeMode;
  entityId?: string | null;
}): DashboardPnlView {
  const report = opts.report;
  const entityId =
    opts.scope === 'company' && opts.entityId?.trim()
      ? opts.entityId.trim()
      : null;

  const lastSyncAt =
    report?.last_sync?.finished_at ??
    report?.last_sync?.started_at ??
    null;

  if (!report) {
    return emptyView({
      scope: entityId ? 'company' : 'consolidated',
      entity_id: entityId,
      title: entityId
        ? `${entityDisplayName(entityId)} P&L`
        : 'Consolidated P&L',
      note: 'IES not available — connect books in Shared Services → Finance.',
      finance_href: entityId
        ? `/shared-services/finance?entity=${encodeURIComponent(entityId)}`
        : '/shared-services/finance',
    });
  }

  if (entityId) {
    const row =
      report.companies.find((c) => c.entity_id === entityId) ?? null;
    const href = `/shared-services/finance?entity=${encodeURIComponent(entityId)}`;
    const companySynced = row?.last_sync_at ?? lastSyncAt;
    if (!row || !hasAnyPnl(row)) {
      return {
        ...emptyView({
          scope: 'company',
          entity_id: entityId,
          title: `${entityDisplayName(entityId)} P&L`,
          note:
            row?.todo ??
            'Not Connected — connect IES for this company and Refresh.',
          finance_href: href,
          last_synced_at: companySynced,
        }),
        stale: row?.stale ?? true,
        data_gaps: row?.data_gaps?.length
          ? row.data_gaps
          : ['No IES P&L snapshot synced'],
      };
    }
    const connected = hasAnyPnl(row);
    const partial =
      row.feed_status === 'partial' ||
      row.revenue == null ||
      row.net_income == null;
    return {
      scope: 'company',
      entity_id: entityId,
      title: `${entityDisplayName({
        name: row.company_name,
        entity_id: entityId,
      })} P&L`,
      subtitle: row.as_of
        ? `IES snapshot · as of ${row.as_of}`
        : 'IES books · native sync',
      state: stateFromRow(report, connected, partial),
      as_of: row.as_of,
      stale: row.stale,
      revenue: row.revenue,
      expenses: row.expenses,
      net_income: row.net_income,
      cash_on_hand: row.cash_on_hand,
      ar_balance: row.ar_balance,
      ap_balance: row.ap_balance,
      feed_status: row.feed_status,
      note:
        entityId === 'ENT-FIRM'
          ? 'Parent books — capital, SSC/holdco, and intercompany (operating revenue stays in subsidiaries).'
          : `Company P&L from IES sync. ${IES_EMBED_POLICY}`,
      data_gaps: row.data_gaps,
      display_mode: 'native_ies_sync',
      finance_href: href,
      open_in_ies_href: iesOpenInBooksHref(entityId),
      last_synced_at: companySynced,
      embed_policy: IES_EMBED_POLICY,
    };
  }

  const c = report.consolidated;
  const connected = hasAnyPnl({
    revenue: c.revenue,
    expenses: c.expenses,
    net_income: c.net_income,
    cash_on_hand: c.cash_on_hand,
  });
  const partial = c.feed_status === 'partial' || !connected;
  return {
    scope: 'consolidated',
    entity_id: null,
    title: 'Consolidated P&L',
    subtitle: c.as_of
      ? `Management consolidation · as of ${c.as_of}`
      : 'Management consolidation · IES sync',
    state: stateFromRow(report, connected, partial || c.feed_status !== 'ok'),
    as_of: c.as_of,
    stale: report.companies.some((r) => r.stale),
    revenue: c.revenue ?? null,
    expenses: c.expenses ?? null,
    net_income: c.net_income ?? null,
    cash_on_hand: c.cash_on_hand,
    ar_balance: c.ar_balance,
    ap_balance: c.ap_balance,
    feed_status: c.feed_status,
    note: `${c.note} ${IES_EMBED_POLICY}`,
    data_gaps: c.data_gaps.slice(0, 6),
    display_mode: 'native_ies_sync',
    finance_href: '/shared-services/finance',
    open_in_ies_href: iesOpenInBooksHref(null),
    last_synced_at: lastSyncAt,
    embed_policy: IES_EMBED_POLICY,
  };
}

/** Parent firm (Tage Venture Capital) financial + KPI strip. */
export function buildTageVcFirmPerformance(
  report: IesFinanceReport | null | undefined,
): FirmPerformanceView {
  const base = buildDashboardPnlView({
    report,
    scope: 'company',
    entityId: 'ENT-FIRM',
  });
  return {
    ...base,
    entity_id: 'ENT-FIRM',
    is_parent: true,
    title: 'Tage Venture Capital — firm performance',
    subtitle:
      base.state === 'not_connected'
        ? 'Parent firm books · Not Connected'
        : 'Parent firm books · capital, SSC, intercompany',
    note:
      'Firm (parent) financials for Visionary and Accounting / Finance — not buried under subsidiaries.',
  };
}

export function formatPnlMetric(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return 'Not Connected';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}
