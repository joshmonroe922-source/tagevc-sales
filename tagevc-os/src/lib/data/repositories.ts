import { buildCapitalPulseFromIes } from '@/lib/command-center/capital-pulse';
import { SEED_PERIOD } from '@/lib/data/seed';
import { ensureMasterData } from '@/lib/data/master-data';
import { isHiddenActiveCompany } from '@/lib/entities/registry-visibility';
import {
  listScopedActiveDeals,
  listScopedActiveLeads,
  listScopedOpenLeadTasks,
} from '@/lib/data/pipeline-scope';
import { getIesFinanceReport } from '@/lib/ies/report';
import { computePortfolioRollup } from '@/lib/portfolio/rollup';
import {
  buildParentIndex,
  canAccessEntityId,
  isFirmWideAccess,
} from '@/lib/rbac/entity-scope';
import { getSessionContext } from '@/lib/rbac/session';
import type {
  CommandCenterSnapshot,
  Entity,
  EntityMonthPnl,
  PortfolioCompany,
  PortfolioCompanyDetail,
  PortfolioRollup,
} from '@/lib/types';

async function scopeFilter() {
  const [session, master] = await Promise.all([
    getSessionContext(),
    ensureMasterData(),
  ]);
  const parentByEntityId = buildParentIndex(master.entities);
  if (!session) {
    return {
      firmWide: false,
      role: null as null,
      entityId: null as string | null,
      parentByEntityId,
    };
  }
  return {
    firmWide: isFirmWideAccess(
      session.profile.role,
      session.profile.entity_id,
    ),
    role: session.profile.role,
    entityId: session.profile.entity_id,
    parentByEntityId,
  };
}

function filterCompanies(
  companies: PortfolioCompany[],
  scope: Awaited<ReturnType<typeof scopeFilter>>,
): PortfolioCompany[] {
  if (scope.firmWide || !scope.role) return companies;
  return companies.filter((c) =>
    canAccessEntityId(
      scope.role!,
      scope.entityId,
      c.entity_id,
      scope.parentByEntityId,
    ),
  );
}

function filterEntities(
  entities: Entity[],
  scope: Awaited<ReturnType<typeof scopeFilter>>,
): Entity[] {
  if (scope.firmWide || !scope.role) return entities;
  return entities.filter((e) =>
    canAccessEntityId(
      scope.role!,
      scope.entityId,
      e.entity_id,
      scope.parentByEntityId,
    ),
  );
}

function filterPnl(
  pnl: EntityMonthPnl[],
  scope: Awaited<ReturnType<typeof scopeFilter>>,
): EntityMonthPnl[] {
  if (scope.firmWide || !scope.role) return pnl;
  return pnl.filter((r) =>
    canAccessEntityId(
      scope.role!,
      scope.entityId,
      r.entity_id,
      scope.parentByEntityId,
    ),
  );
}

/** Active subsidiaries on Portfolio Active (excludes RE-only / Firm). */
export async function listActivePortfolioCompanies(): Promise<
  PortfolioCompany[]
> {
  const [master, scope] = await Promise.all([
    ensureMasterData(),
    scopeFilter(),
  ]);
  return filterCompanies(master.companies, scope)
    .filter((c) => !isHiddenActiveCompany(c))
    .sort((a, b) => a.company_name.localeCompare(b.company_name));
}

export async function getPortfolioCompanyById(
  portfolioId: string,
): Promise<PortfolioCompanyDetail | null> {
  const [master, scope] = await Promise.all([
    ensureMasterData(),
    scopeFilter(),
  ]);
  const company = master.companies.find((c) => c.portfolio_id === portfolioId);
  if (!company) return null;
  if (
    scope.role &&
    !canAccessEntityId(
      scope.role,
      scope.entityId,
      company.entity_id,
      scope.parentByEntityId,
    )
  ) {
    return null;
  }
  const entity =
    master.entities.find((e) => e.entity_id === company.entity_id) ?? null;
  return { ...company, entity };
}

export async function listEntities(): Promise<Entity[]> {
  const [master, scope] = await Promise.all([
    ensureMasterData(),
    scopeFilter(),
  ]);
  return filterEntities(master.entities, scope);
}

export async function getEntityById(entityId: string): Promise<Entity | null> {
  const [master, scope] = await Promise.all([
    ensureMasterData(),
    scopeFilter(),
  ]);
  if (
    scope.role &&
    !canAccessEntityId(
      scope.role,
      scope.entityId,
      entityId,
      scope.parentByEntityId,
    )
  ) {
    return null;
  }
  return master.entities.find((e) => e.entity_id === entityId) ?? null;
}

export async function getPortfolioRollup(
  period?: string,
): Promise<PortfolioRollup> {
  const [master, scope, iesReport] = await Promise.all([
    ensureMasterData(),
    scopeFilter(),
    getIesFinanceReport({ entityId: 'ENT-FIRM' }).catch(() => null),
  ]);
  // Match listActivePortfolioCompanies: exclude Sample Closed Co / Sample Indy
  // SFR so KPI cards (ARR, burn, runway, cash) equal the visible company table.
  const companies = filterCompanies(master.companies, scope).filter(
    (c) => !isHiddenActiveCompany(c),
  );
  const visibleEntityIds = new Set(companies.map((c) => c.entity_id));
  const pnlRows = filterPnl(master.pnl, scope).filter(
    (r) => !r.is_firm && visibleEntityIds.has(r.entity_id),
  );
  const pulse = buildCapitalPulseFromIes(iesReport);
  return computePortfolioRollup({
    period: period ?? master.period ?? SEED_PERIOD,
    companies,
    pnlRows,
    // Never fall back to seed firm P&L ($800k) — honest Not Connected.
    liveFirmCashK: pulse.firm_cash_k,
  });
}

export async function getCommandCenterSnapshot(): Promise<CommandCenterSnapshot> {
  const master = await ensureMasterData();
  const companies = await listActivePortfolioCompanies();
  const rollup = await getPortfolioRollup(master.period);
  const [activeLeads, openTasks, deals, iesReport] = await Promise.all([
    listScopedActiveLeads(),
    listScopedOpenLeadTasks(),
    listScopedActiveDeals(),
    // Capital Pulse: live IES only — never seed portfolio P&L inflation.
    getIesFinanceReport().catch(() => null),
  ]);
  const readyForDd = activeLeads.filter((l) => l.stage === 'Ready for DD');
  const blocked = openTasks.filter((t) => t.status === 'Blocked');
  const closing = deals.filter(
    (d) =>
      d.exec_stage === 'Closing Conditions' ||
      d.exec_stage === 'Signing Ready' ||
      d.exec_stage === 'Wired / Closed',
  );
  const capital = buildCapitalPulseFromIes(iesReport);

  return {
    period: rollup.period,
    freshness:
      capital.source === 'ies'
        ? 'FRESH'
        : master.source === 'sql'
          ? 'FRESH'
          : 'UNKNOWN',
    funnel: {
      active_leads: activeLeads.length,
      ready_for_dd: readyForDd.length,
      open_dd_tasks: openTasks.length,
      blocked_dd_tasks: blocked.length,
      active_deals: deals.length,
      deals_in_closing: closing.length,
    },
    portfolio_health: rollup.health_counts,
    capital,
    active_portfolio_companies: companies.length,
    attention_required: rollup.attention_required,
  };
}
