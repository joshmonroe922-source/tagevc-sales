import {
  getCommandCenterSnapshot,
  getPortfolioRollup,
  listActivePortfolioCompanies,
} from '@/lib/data/repositories';
import { listActiveLeads } from '@/lib/data/deal-flow-store';
import { listDocuments } from '@/lib/data/document-store';
import { listScopedTickets } from '@/lib/data/pipeline-scope';
import { entityDisplayName } from '@/lib/entities/display-name';
import {
  catalogForRole,
  emptyCardsForRole,
  type DashboardScopeMode,
  type RoleDashboardCard,
} from '@/lib/dashboard/role-dashboard-catalog';
import { formatPnlMetric } from '@/lib/dashboard/ies-pnl-view';
import { getIesFinanceReport } from '@/lib/ies/report';
import { classifyTicketSla } from '@/lib/shared-services/shared-services-inbox-phase54';
import { createPersistClient } from '@/lib/supabase/persist-client';
import type { AppRole } from '@/lib/types/roles';
import { APP_ROLES } from '@/lib/types/roles';
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

  const [rollup, companies, snapshot, tickets, iesReport] = await Promise.all([
    getPortfolioRollup().catch(() => null),
    listActivePortfolioCompanies().catch(() => []),
    getCommandCenterSnapshot().catch(() => null),
    listScopedTickets().catch(() => []),
    getIesFinanceReport().catch(() => null),
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

  // Firm AUM excludes private I-quadrant (stock/retirement/crypto)
  try {
    const { getFirmAumSnapshot } = await import('@/lib/net-worth/assets');
    const aum = await getFirmAumSnapshot();
    const aumLabel =
      aum.asset_count > 0
        ? `${formatUsdK(aum.total / 1000)}k · ${aum.asset_count} firm assets`
        : 'No firm-visible assets registered';
    set('aum_dry_powder', {
      actual: aumLabel,
      data_state: aum.asset_count > 0 ? 'partial' : 'not_connected',
      variance_label: aum.label,
      goal: 'Excludes private stock / retirement / crypto',
    });
  } catch {
    /* fail-soft */
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

  // Live IES: consolidated / finance KPIs (never invent sample P&L)
  if (iesReport) {
    const firm =
      iesReport.companies.find((c) => c.entity_id === 'ENT-FIRM') ?? null;
    const firmLive =
      firm &&
      (firm.cash_on_hand != null ||
        firm.revenue != null ||
        firm.net_income != null);
    const consol = iesReport.consolidated;
    const consolLive =
      consol.cash_on_hand != null ||
      consol.revenue != null ||
      consol.net_income != null;

    if (consolLive) {
      set('sub_financials', {
        actual: `Consol rev ${formatPnlMetric(consol.revenue)} · net ${formatPnlMetric(consol.net_income)} · cash ${formatPnlMetric(consol.cash_on_hand)}`,
        data_state: consol.feed_status === 'ok' ? 'live' : 'partial',
        variance_label: 'Management consolidation · eliminations not applied',
      });
      set('portfolio_performance', {
        actual: `Consol net ${formatPnlMetric(consol.net_income)} · cash ${formatPnlMetric(consol.cash_on_hand)}`,
        data_state: consol.feed_status === 'ok' ? 'live' : 'partial',
      });
      set('portfolio_health', {
        actual: `IES cash ${formatPnlMetric(consol.cash_on_hand)} · net ${formatPnlMetric(consol.net_income)} · ${companies.length} cos`,
        data_state: consol.feed_status === 'ok' ? 'live' : 'partial',
        variance_label: 'Native IES sync · see Tage VC firm panel for parent',
      });
    }
    set('cash_visibility', {
      actual: consolLive
        ? `Cash ${formatPnlMetric(consol.cash_on_hand)} · ${iesReport.companies.filter((c) => c.feed_status === 'ok' || c.feed_status === 'partial').length}/${iesReport.companies.length} companies synced`
        : 'Not Connected — pull IES',
      data_state: consolLive
        ? consol.feed_status === 'ok'
          ? 'live'
          : 'partial'
        : 'not_connected',
      variance_label: iesReport.last_sync
        ? `Last sync · ${iesReport.last_sync.status}`
        : 'No sync runs yet',
    });
    set('kpi_pack_ready', {
      actual: `${iesReport.companies.filter((c) => c.revenue != null || c.net_income != null).length}/${iesReport.companies.length} entities with P&L snapshot`,
      data_state: consolLive ? 'partial' : 'not_connected',
    });
    if (opts.scope === 'company' && opts.entityId === 'ENT-FIRM' && firm) {
      set('unit_economics', {
        actual: firmLive
          ? `Rev ${formatPnlMetric(firm.revenue)} · Exp ${formatPnlMetric(firm.expenses)} · Net ${formatPnlMetric(firm.net_income)}`
          : 'Not Connected',
        data_state: firmLive ? 'partial' : 'not_connected',
        company_id: 'ENT-FIRM',
        company_name: 'Tage Venture Capital',
      });
    }
  }

  // Admin ops KPIs — users, tickets, SSC health, docs, access
  if (opts.role === 'admin') {
    set('ticket_backlog', {
      actual: `${openTickets.length} open · ${dueCounts.overdue} overdue · ${dueCounts.due_soon} due soon`,
      data_state: 'live',
    });
    set('ticket_sla', {
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
    set('help_desk_load', {
      actual: `${openTickets.length} open tickets firm-wide`,
      data_state: 'live',
    });
    set('ssc_health', {
      actual:
        dueCounts.overdue > 0
          ? `${dueCounts.overdue} overdue · ${dueCounts.due_soon} due soon (SSC pressure)`
          : `${openTickets.length} open · no SLA breaches`,
      data_state: 'partial',
      on_track: dueCounts.overdue === 0 ? true : false,
      variance_label:
        dueCounts.overdue === 0 ? 'Healthy' : 'Needs attention',
    });
    try {
      const docs = listDocuments();
      const withAcl = docs.filter(
        (d) => Array.isArray(d.visible_roles) && d.visible_roles.length > 0,
      ).length;
      set('doc_library', {
        actual: `${docs.length} active documents`,
        data_state: 'partial',
      });
      set('access_control', {
        actual: `${withAcl} docs with role ACL · ${APP_ROLES.length} roles defined`,
        data_state: 'partial',
      });
    } catch {
      set('doc_library', {
        actual: null,
        data_state: 'not_connected',
      });
    }
    try {
      const sb = await createPersistClient();
      const { count, error } = await sb
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('active', true);
      if (!error && count != null) {
        set('active_users', {
          actual: `${count} active profiles`,
          data_state: 'live',
        });
        set('admin_queue', {
          actual: `${count} users · Admin + system health tools`,
          data_state: 'partial',
          variance_label: 'Open Shared Services → Admin',
        });
      } else {
        set('active_users', {
          actual: null,
          data_state: 'not_connected',
        });
        set('admin_queue', {
          actual: 'Users · roles · system health',
          data_state: 'partial',
          variance_label: 'Open Shared Services → Admin',
        });
      }
    } catch {
      set('active_users', {
        actual: null,
        data_state: 'not_connected',
      });
      set('admin_queue', {
        actual: 'Users · roles · system health',
        data_state: 'partial',
        variance_label: 'Open Shared Services → Admin',
      });
    }
  }

  if (opts.scope === 'company' && opts.entityId) {
    const entityId = opts.entityId;
    const name = entityDisplayName(entityId);
    const entityTickets = openTickets.filter((t) => t.entity_id === entityId);
    const companyCards = base.map((c) => ({
      ...c,
      company_id: entityId,
      company_name: name,
      description: `${c.description} · ${name}`,
    }));
    // Prefer entity-scoped ticket KPIs when present
    const withTickets = companyCards.map((c) => {
      if (c.kpi_id === 'volume_backlog' || c.kpi_id === 'due_status_rate') {
        return {
          ...c,
          actual: `${entityTickets.length} open tickets for ${name}`,
          data_state: 'partial' as const,
        };
      }
      return c;
    });
    return {
      cards: withTickets,
      scope: opts.scope,
      role: opts.role,
    };
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
