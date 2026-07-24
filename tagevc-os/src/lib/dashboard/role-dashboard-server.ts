import {
  getCommandCenterSnapshot,
  getPortfolioRollup,
  listActivePortfolioCompanies,
} from '@/lib/data/repositories';
import { listActiveLeads } from '@/lib/data/deal-flow-store';
import { listScopedTickets } from '@/lib/data/pipeline-scope';
import { entityDisplayName } from '@/lib/entities/display-name';
import {
  catalogForRole,
  emptyCardsForRole,
  type DashboardScopeMode,
  type RoleDashboardCard,
} from '@/lib/dashboard/role-dashboard-catalog';
import { classifyTicketSla } from '@/lib/shared-services/shared-services-inbox-phase54';
import type { AppRole } from '@/lib/types/roles';
import { formatUsdK } from '@/lib/format';

function cardFrom(
  def: ReturnType<typeof catalogForRole>[number],
  patch: Partial<RoleDashboardCard>,
): RoleDashboardCard {
  return {
    ...def,
    actual: null,
    goal: null,
    variance_label: 'Goal not set',
    on_track: null,
    data_state: 'not_connected',
    ...patch,
  };
}

/**
 * Builds role dashboard cards. Wires live actuals where stores already expose
 * data; remaining cards stay not_connected / partial — never fake numbers.
 */
export async function buildRoleDashboardCards(opts: {
  role: AppRole;
  scope: DashboardScopeMode;
  entityId?: string | null;
}): Promise<{
  cards: RoleDashboardCard[];
  scope: DashboardScopeMode;
  role: AppRole;
}> {
  const defs = catalogForRole(opts.role);
  const byId = Object.fromEntries(defs.map((d) => [d.kpi_id, d]));

  const [rollup, companies, snapshot, tickets] = await Promise.all([
    getPortfolioRollup().catch(() => null),
    listActivePortfolioCompanies().catch(() => []),
    getCommandCenterSnapshot().catch(() => null),
    listScopedTickets().catch(() => []),
  ]);

  let activeLeads = 0;
  try {
    activeLeads = listActiveLeads().length;
  } catch {
    activeLeads = 0;
  }

  const openTickets = (tickets ?? []).filter(
    (t) => t.status !== 'Closed' && t.status !== 'Resolved',
  );
  const dueCounts = { on_time: 0, due_soon: 0, overdue: 0, none: 0 };
  for (const t of openTickets) {
    const s = classifyTicketSla(t);
    if (s === 'ok') dueCounts.on_time += 1;
    else if (s === 'due_soon') dueCounts.due_soon += 1;
    else if (s === 'breached') dueCounts.overdue += 1;
    else dueCounts.none += 1;
  }
  const withDue = dueCounts.on_time + dueCounts.due_soon + dueCounts.overdue;
  const dueAttainment =
    withDue > 0 ? Math.round((dueCounts.on_time / withDue) * 100) : null;

  const base = emptyCardsForRole(opts.role).map((c) => ({ ...c }));

  function set(kpiId: string, patch: Partial<RoleDashboardCard>) {
    const idx = base.findIndex((c) => c.kpi_id === kpiId);
    if (idx < 0) return;
    const def = byId[kpiId];
    if (!def) return;
    base[idx] = cardFrom(def, { ...base[idx], ...patch });
  }

  if (rollup) {
    set('portfolio_health', {
      actual: `${companies.length} cos · ARR ${formatUsdK(rollup.portfolio_arr_k)}k · burn ${formatUsdK(rollup.portfolio_net_burn_k)}k`,
      data_state: 'partial',
      variance_label: rollup.runway_breach ? 'Runway review' : 'Goal not set',
      on_track: rollup.runway_breach ? false : null,
    });
    set('cash_runway', {
      actual: `${rollup.min_runway_mo ?? '—'} mo min runway`,
      data_state: 'partial',
    });
    set('revenue_arr', {
      actual: `${formatUsdK(rollup.portfolio_arr_k)}k ARR`,
      data_state: 'partial',
    });
    set('sub_financials', {
      actual: `${companies.length} companies · ARR ${formatUsdK(rollup.portfolio_arr_k)}k`,
      data_state: 'partial',
    });
  }

  set('pipeline_quality', {
    actual: `${activeLeads} active leads · ${companies.length} portfolio cos`,
    data_state: 'partial',
  });
  set('deal_pipeline', {
    actual: `${activeLeads} active leads in store`,
    data_state: 'partial',
  });
  set('opps_sourced', {
    actual: `${activeLeads} active leads`,
    data_state: 'partial',
  });
  set('funnel_conversion', {
    actual: `${activeLeads} active leads (conversion goals not configured)`,
    data_state: 'partial',
  });
  set('due_status_rate', {
    actual:
      dueAttainment == null
        ? `${openTickets.length} open · no due dates`
        : `${dueAttainment}% on time (${dueCounts.on_time}/${withDue}) · ${dueCounts.overdue} overdue`,
    data_state: openTickets.length ? 'live' : 'partial',
    goal: '≥ 90% on time',
    on_track: dueAttainment == null ? null : dueAttainment >= 90,
    variance_label:
      dueAttainment == null
        ? 'Goal not set'
        : dueAttainment >= 90
          ? 'On track'
          : `${90 - dueAttainment} pts below goal`,
  });
  set('volume_backlog', {
    actual: `${openTickets.length} open tickets · ${dueCounts.overdue} overdue · ${dueCounts.due_soon} due soon`,
    data_state: 'live',
  });
  set('escalation_effectiveness', {
    actual: `${dueCounts.overdue} overdue tickets`,
    data_state: 'partial',
  });
  set('ops_red_flags', {
    actual: `${dueCounts.overdue} overdue · ${dueCounts.due_soon} due soon`,
    data_state: 'partial',
  });

  if (snapshot) {
    set('org_capacity', {
      actual: 'Command Center snapshot available',
      data_state: 'partial',
    });
  }

  if (opts.scope === 'by_company') {
    const byCompanyCards: RoleDashboardCard[] = [];
    const entityIds = [
      ...new Set(
        [
          ...companies.map((c) => c.entity_id),
          'ENT-R619',
          'ENT-INDA',
          'ENT-FIRM',
        ].filter(Boolean),
      ),
    ] as string[];
    for (const entityId of entityIds.slice(0, 8)) {
      const name = entityDisplayName(entityId);
      const entityTickets = openTickets.filter((t) => t.entity_id === entityId);
      const seed = defs[0] ?? catalogForRole(opts.role)[0];
      byCompanyCards.push(
        cardFrom(seed, {
          kpi_id: `company_${entityId}`,
          label: name,
          description: 'Open work for this company',
          actual: `${entityTickets.length} open tickets`,
          goal: null,
          variance_label: 'Goal not set',
          on_track: null,
          data_state: 'partial',
          company_id: entityId,
          company_name: name,
        }),
      );
    }
    return {
      cards: [...byCompanyCards, ...base],
      scope: opts.scope,
      role: opts.role,
    };
  }

  return { cards: base, scope: opts.scope, role: opts.role };
}
