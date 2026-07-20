import { SEED_PERIOD } from '@/lib/data/seed';
import { ensureMasterData } from '@/lib/data/master-data';
import {
  listActiveDeals,
  listActiveLeads,
  listOpenLeadTasks,
} from '@/lib/data/deal-flow-store';
import { computePortfolioRollup } from '@/lib/portfolio/rollup';
import {
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
  const session = await getSessionContext();
  if (!session) {
    return {
      firmWide: false,
      role: null as null,
      entityId: null as string | null,
    };
  }
  return {
    firmWide: isFirmWideAccess(
      session.profile.role,
      session.profile.entity_id,
    ),
    role: session.profile.role,
    entityId: session.profile.entity_id,
  };
}

function filterCompanies(
  companies: PortfolioCompany[],
  scope: Awaited<ReturnType<typeof scopeFilter>>,
): PortfolioCompany[] {
  if (scope.firmWide || !scope.role) return companies;
  return companies.filter((c) =>
    canAccessEntityId(scope.role!, scope.entityId, c.entity_id),
  );
}

function filterEntities(
  entities: Entity[],
  scope: Awaited<ReturnType<typeof scopeFilter>>,
): Entity[] {
  if (scope.firmWide || !scope.role) return entities;
  return entities.filter((e) =>
    canAccessEntityId(scope.role!, scope.entityId, e.entity_id),
  );
}

function filterPnl(
  pnl: EntityMonthPnl[],
  scope: Awaited<ReturnType<typeof scopeFilter>>,
): EntityMonthPnl[] {
  if (scope.firmWide || !scope.role) return pnl;
  return pnl.filter((r) =>
    canAccessEntityId(scope.role!, scope.entityId, r.entity_id),
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
  return filterCompanies(master.companies, scope).sort((a, b) =>
    a.company_name.localeCompare(b.company_name),
  );
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
    !canAccessEntityId(scope.role, scope.entityId, company.entity_id)
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
    !canAccessEntityId(scope.role, scope.entityId, entityId)
  ) {
    return null;
  }
  return master.entities.find((e) => e.entity_id === entityId) ?? null;
}

export async function getPortfolioRollup(
  period?: string,
): Promise<PortfolioRollup> {
  const [master, scope] = await Promise.all([
    ensureMasterData(),
    scopeFilter(),
  ]);
  const companies = filterCompanies(master.companies, scope);
  return computePortfolioRollup({
    period: period ?? master.period ?? SEED_PERIOD,
    companies,
    pnlRows: filterPnl(master.pnl, scope),
  });
}

export async function getCommandCenterSnapshot(): Promise<CommandCenterSnapshot> {
  const master = await ensureMasterData();
  const companies = await listActivePortfolioCompanies();
  const rollup = await getPortfolioRollup(master.period);
  const activeLeads = listActiveLeads();
  const readyForDd = activeLeads.filter((l) => l.stage === 'Ready for DD');
  const openTasks = listOpenLeadTasks();
  const blocked = openTasks.filter((t) => t.status === 'Blocked');
  const deals = listActiveDeals();
  const closing = deals.filter(
    (d) =>
      d.exec_stage === 'Closing Conditions' ||
      d.exec_stage === 'Signing Ready' ||
      d.exec_stage === 'Wired / Closed',
  );

  return {
    period: rollup.period,
    freshness: master.source === 'sql' ? 'FRESH' : 'UNKNOWN',
    funnel: {
      active_leads: activeLeads.length,
      ready_for_dd: readyForDd.length,
      open_dd_tasks: openTasks.length,
      blocked_dd_tasks: blocked.length,
      active_deals: deals.length,
      deals_in_closing: closing.length,
    },
    portfolio_health: rollup.health_counts,
    capital: {
      portfolio_arr_k: rollup.portfolio_arr_k,
      portfolio_gross_margin: rollup.portfolio_gross_margin,
      portfolio_net_burn_k: rollup.portfolio_net_burn_k,
      portfolio_cash_k: rollup.portfolio_cash_k,
      firm_cash_k: rollup.firm_cash_k,
      consolidated_cash_k: rollup.consolidated_cash_k,
      min_runway_mo: rollup.min_runway_mo,
      runway_breach: rollup.runway_breach,
    },
    active_portfolio_companies: companies.length,
    attention_required: rollup.attention_required,
  };
}
