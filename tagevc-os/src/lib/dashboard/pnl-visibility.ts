/**
 * Dashboard / Finance P&L visibility by effective role.
 * Server-side enforcement — URL ?scope=&entity= cannot widen access.
 *
 * Matrix (high level):
 * - Visionary + Accounting/Finance: full firm (consolidated + all companies + firm strip)
 * - Partner: subsidiaries + Tage VC + consolidated (no dedicated firm strip)
 * - COO (Subsidiaries): only coo_owner / assignment-to-lead entities
 * - Subsidiary Leader: only led entity
 */

import {
  isAssignedToLeadEntity,
  isLeadScopedAssetRole,
  resolveSubsidiaryLeaderEntityId,
} from '@/lib/entities/assignment-lead';
import { normalizeEntityId } from '@/lib/entities/display-name';
import { canViewTageVcFirmPerformance } from '@/lib/dashboard/ies-pnl-view';
import type { DashboardScopeMode } from '@/lib/dashboard/role-dashboard-catalog';
import type { IesEntityFinanceRow, IesFinanceReport } from '@/lib/ies/report';
import type { Entity } from '@/lib/types/entities';
import type { AppRole } from '@/lib/types/roles';

/** Roles that may open the live P&L panel at all. */
export const PNL_VIEW_ROLES: readonly AppRole[] = [
  'visionary',
  'partner',
  'ssc_finance',
  'coo',
  'sub_lead',
] as const;

/** Full firm P&L: consolidated + every IES operating company. */
export const PNL_FULL_FIRM_ROLES: readonly AppRole[] = [
  'visionary',
  'ssc_finance',
] as const;

/** Partner: same company list + consolidated; firm strip stays Visionary/Finance. */
export const PNL_PARTNER_ROLES: readonly AppRole[] = ['partner'] as const;

export type PnlEntityRef = Pick<
  Entity,
  'entity_id' | 'coo_owner' | 'parent_entity_id'
>;

export type PnlScopeAccess = {
  role: AppRole;
  canViewLivePnl: boolean;
  canViewConsolidated: boolean;
  /** Dedicated Tage VC firm performance strip (Visionary + ssc_finance). */
  canViewFirmPerformance: boolean;
  /** 'all' = every IES operating entity; else explicit allow-list. */
  allowedEntityIds: 'all' | string[];
};

export function canViewLivePnl(role: AppRole): boolean {
  return (PNL_VIEW_ROLES as readonly string[]).includes(role);
}

export function isFullFirmPnlRole(role: AppRole): boolean {
  return (PNL_FULL_FIRM_ROLES as readonly string[]).includes(role);
}

export function isPartnerPnlRole(role: AppRole): boolean {
  return (PNL_PARTNER_ROLES as readonly string[]).includes(role);
}

/**
 * Resolve which P&L scopes the effective role may see.
 * Pass entity master rows so COO assignment (coo_owner) can be evaluated.
 */
export function resolvePnlScopeAccess(input: {
  role: AppRole;
  profileEntityId?: string | null;
  profileFullName?: string | null;
  entities?: readonly PnlEntityRef[];
}): PnlScopeAccess {
  const { role, profileEntityId, profileFullName } = input;
  const entities = input.entities ?? [];

  if (!canViewLivePnl(role)) {
    return {
      role,
      canViewLivePnl: false,
      canViewConsolidated: false,
      canViewFirmPerformance: false,
      allowedEntityIds: [],
    };
  }

  if (isFullFirmPnlRole(role) || isPartnerPnlRole(role)) {
    return {
      role,
      canViewLivePnl: true,
      canViewConsolidated: true,
      canViewFirmPerformance: canViewTageVcFirmPerformance(role),
      allowedEntityIds: 'all',
    };
  }

  // COO / Subsidiary Leader — assignment-to-lead only; never firm consolidated.
  if (isLeadScopedAssetRole(role)) {
    const allowed = entities
      .filter((entity) =>
        isAssignedToLeadEntity({
          role,
          profileEntityId,
          profileFullName,
          entity,
        }),
      )
      .map((e) => normalizeEntityId(e.entity_id))
      .filter(Boolean);

    // Ensure sub_lead always has at least their led id even if entity row missing.
    if (role === 'sub_lead') {
      const led = resolveSubsidiaryLeaderEntityId(profileEntityId);
      if (led && !allowed.includes(led)) allowed.push(led);
    }

    return {
      role,
      canViewLivePnl: true,
      canViewConsolidated: false,
      canViewFirmPerformance: false,
      allowedEntityIds: [...new Set(allowed)],
    };
  }

  return {
    role,
    canViewLivePnl: false,
    canViewConsolidated: false,
    canViewFirmPerformance: false,
    allowedEntityIds: [],
  };
}

export function canAccessPnlEntity(
  access: PnlScopeAccess,
  entityId: string | null | undefined,
): boolean {
  if (!access.canViewLivePnl) return false;
  const id = normalizeEntityId(entityId);
  if (!id) return false;
  if (access.allowedEntityIds === 'all') return true;
  return access.allowedEntityIds.includes(id);
}

export function filterCompanyOptionsForPnl<T extends { entity_id: string }>(
  options: readonly T[],
  access: PnlScopeAccess,
): T[] {
  if (!access.canViewLivePnl) return [];
  if (access.allowedEntityIds === 'all') return [...options];
  const allow = new Set(access.allowedEntityIds);
  return options.filter((o) => allow.has(normalizeEntityId(o.entity_id)));
}

/**
 * Clamp Dashboard ?scope=&entity= to what the role may see.
 * Never widens access; falls back to a safe default when denied.
 */
export function enforcePnlDashboardScope(input: {
  access: PnlScopeAccess;
  requestedScope: DashboardScopeMode;
  requestedEntityId?: string | null;
}): {
  scope: DashboardScopeMode;
  entityId: string | null;
  denied: boolean;
} {
  const { access } = input;
  const requestedEntityId = normalizeEntityId(input.requestedEntityId) || null;

  if (!access.canViewLivePnl) {
    return { scope: 'consolidated', entityId: null, denied: true };
  }

  if (input.requestedScope === 'company' && requestedEntityId) {
    if (canAccessPnlEntity(access, requestedEntityId)) {
      return {
        scope: 'company',
        entityId: requestedEntityId,
        denied: false,
      };
    }
    // URL bypass attempt — fall back to first allowed (or consolidated if allowed).
    return fallbackScope(access, true);
  }

  if (
    input.requestedScope === 'consolidated' ||
    input.requestedScope === 'by_company'
  ) {
    if (access.canViewConsolidated) {
      return {
        scope: input.requestedScope === 'by_company' ? 'by_company' : 'consolidated',
        entityId: null,
        denied: false,
      };
    }
    return fallbackScope(access, true);
  }

  // Default: consolidated when allowed, else first company.
  if (access.canViewConsolidated) {
    return { scope: 'consolidated', entityId: null, denied: false };
  }
  return fallbackScope(access, false);
}

function fallbackScope(
  access: PnlScopeAccess,
  denied: boolean,
): {
  scope: DashboardScopeMode;
  entityId: string | null;
  denied: boolean;
} {
  if (access.allowedEntityIds === 'all') {
    return { scope: 'consolidated', entityId: null, denied };
  }
  const first = access.allowedEntityIds[0] ?? null;
  if (first) {
    return { scope: 'company', entityId: first, denied };
  }
  return { scope: 'company', entityId: null, denied: true };
}

/**
 * Finance ?entity= clamp — firm-wide P&L roles may pick any entity (or null);
 * lead-scoped roles are locked to an allowed company (no null = full consol).
 */
export function enforcePnlFinanceEntity(input: {
  access: PnlScopeAccess;
  requestedEntityId?: string | null;
}): { entityId: string | null; denied: boolean } {
  const { access } = input;
  const requested = normalizeEntityId(input.requestedEntityId) || null;

  if (!access.canViewLivePnl && !access.canViewFirmPerformance) {
    // Non-P&L roles on Finance still use legacy firm-wide vs profile elsewhere;
    // return requested unchanged for callers that gate separately.
    return { entityId: requested, denied: false };
  }

  if (access.allowedEntityIds === 'all') {
    if (!requested) return { entityId: null, denied: false };
    return { entityId: requested, denied: false };
  }

  if (requested && canAccessPnlEntity(access, requested)) {
    return { entityId: requested, denied: false };
  }

  const first = access.allowedEntityIds[0] ?? null;
  return {
    entityId: first,
    denied: Boolean(requested && requested !== first),
  };
}

/**
 * Strip IES companies the role cannot see. When allow-list is partial,
 * consolidated sums are rebuilt from remaining companies only (defense in depth).
 */
export function filterIesReportForPnlAccess(
  report: IesFinanceReport,
  access: PnlScopeAccess,
): IesFinanceReport {
  if (access.allowedEntityIds === 'all') return report;
  if (!access.canViewLivePnl) {
    return {
      ...report,
      companies: [],
      consolidated: {
        ...report.consolidated,
        cash_on_hand: null,
        ar_balance: null,
        ap_balance: null,
        open_invoices: null,
        overdue_invoices: null,
        revenue: null,
        expenses: null,
        net_income: null,
        feed_status: 'missing',
        data_gaps: ['No P&L access for this role'],
      },
    };
  }

  const allow = new Set(access.allowedEntityIds);
  const companies = report.companies.filter((c) =>
    allow.has(normalizeEntityId(c.entity_id)),
  );
  return {
    ...report,
    companies,
    consolidated: rebuildConsolidated(companies, report.consolidated.note),
  };
}

function rebuildConsolidated(
  companies: IesEntityFinanceRow[],
  note: string,
): IesFinanceReport['consolidated'] {
  const live = companies.filter(
    (c) => c.feed_status === 'ok' || c.feed_status === 'partial',
  );
  const sum = (pick: (r: IesEntityFinanceRow) => number | null) => {
    let t = 0;
    let any = false;
    for (const r of live) {
      const v = pick(r);
      if (v != null) {
        t += v;
        any = true;
      }
    }
    return any ? t : null;
  };
  return {
    cash_on_hand: sum((r) => r.cash_on_hand),
    ar_balance: sum((r) => r.ar_balance),
    ap_balance: sum((r) => r.ap_balance),
    open_invoices: sum((r) => r.open_invoices),
    overdue_invoices: sum((r) => r.overdue_invoices),
    revenue: sum((r) => r.revenue),
    expenses: sum((r) => r.expenses),
    net_income: sum((r) => r.net_income),
    as_of: live[0]?.as_of ?? null,
    feed_status:
      live.length === 0
        ? 'missing'
        : live.every((r) => r.feed_status === 'ok')
          ? 'ok'
          : 'partial',
    note,
    management_consolidation: true,
    data_gaps: [
      ...new Set([
        'Scoped consolidation — only companies visible to this role',
        ...companies.flatMap((c) =>
          c.data_gaps.map((g) => `${c.company_name}: ${g}`),
        ),
      ]),
    ],
  };
}

/** Human-readable role → scopes matrix for docs / tests. */
export function pnlVisibilityMatrixRow(role: AppRole): {
  role: AppRole;
  live_pnl: boolean;
  consolidated: boolean;
  firm_strip: boolean;
  companies: 'all' | 'assigned' | 'led' | 'none';
} {
  if (isFullFirmPnlRole(role)) {
    return {
      role,
      live_pnl: true,
      consolidated: true,
      firm_strip: true,
      companies: 'all',
    };
  }
  if (isPartnerPnlRole(role)) {
    return {
      role,
      live_pnl: true,
      consolidated: true,
      firm_strip: false,
      companies: 'all',
    };
  }
  if (role === 'coo') {
    return {
      role,
      live_pnl: true,
      consolidated: false,
      firm_strip: false,
      companies: 'assigned',
    };
  }
  if (role === 'sub_lead') {
    return {
      role,
      live_pnl: true,
      consolidated: false,
      firm_strip: false,
      companies: 'led',
    };
  }
  return {
    role,
    live_pnl: false,
    consolidated: false,
    firm_strip: false,
    companies: 'none',
  };
}
