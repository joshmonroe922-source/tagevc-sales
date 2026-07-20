import { SEED_PERIOD } from '@/lib/data/seed';
import { ensureMasterData } from '@/lib/data/master-data';
import {
  listActiveDeals,
  listActiveLeads,
  listOpenLeadTasks,
} from '@/lib/data/deal-flow-store';
import { computePortfolioRollup } from '@/lib/portfolio/rollup';
import type {
  CommandCenterSnapshot,
  Entity,
  PortfolioCompany,
  PortfolioCompanyDetail,
  PortfolioRollup,
} from '@/lib/types';

/** Active subsidiaries on Portfolio Active (excludes RE-only / Firm). */
export async function listActivePortfolioCompanies(): Promise<
  PortfolioCompany[]
> {
  const master = await ensureMasterData();
  return [...master.companies].sort((a, b) =>
    a.company_name.localeCompare(b.company_name),
  );
}

export async function getPortfolioCompanyById(
  portfolioId: string,
): Promise<PortfolioCompanyDetail | null> {
  const master = await ensureMasterData();
  const company = master.companies.find((c) => c.portfolio_id === portfolioId);
  if (!company) return null;
  const entity =
    master.entities.find((e) => e.entity_id === company.entity_id) ?? null;
  return { ...company, entity };
}

export async function listEntities(): Promise<Entity[]> {
  const master = await ensureMasterData();
  return [...master.entities];
}

export async function getEntityById(entityId: string): Promise<Entity | null> {
  const master = await ensureMasterData();
  return master.entities.find((e) => e.entity_id === entityId) ?? null;
}

export async function getPortfolioRollup(
  period?: string,
): Promise<PortfolioRollup> {
  const master = await ensureMasterData();
  const companies = await listActivePortfolioCompanies();
  return computePortfolioRollup({
    period: period ?? master.period ?? SEED_PERIOD,
    companies,
    pnlRows: master.pnl,
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
