import { listRecentActivity } from '@/lib/data/activity';
import {
  listScopedActiveDeals,
  listScopedActiveLeads,
  listScopedIcQueue,
  listScopedTickets,
} from '@/lib/data/pipeline-scope';
import { getCommandCenterSnapshot } from '@/lib/data/repositories';
import { entityDisplayName } from '@/lib/entities/display-name';
import type { SessionContext } from '@/lib/rbac/session';
import { APP_ROLE_LABELS } from '@/lib/types/roles';

/** Compact, privacy-aware Tage OS context for Think Tank. Fails soft. */
export async function collectTageThinkTankContext(
  session: SessionContext,
): Promise<Record<string, unknown>> {
  const entityId = session.profile.entity_id ?? 'ENT-FIRM';
  const base: Record<string, unknown> = {
    portal: 'tage',
    companyName: entityDisplayName(entityId),
    entityId,
    realRole: session.realRole,
    effectiveRole: session.profile.role,
    effectiveRoleLabel: APP_ROLE_LABELS[session.profile.role],
    impersonatingAs: session.impersonatingAs,
    impersonatingAsLabel: session.impersonatingAs
      ? APP_ROLE_LABELS[session.impersonatingAs]
      : null,
    goalsHint:
      'If personal KPIs are not stored, help define today/this-week goals from funnel, tickets, IC queue, and portfolio attention.',
  };

  const [snap, activity, tickets, leads, deals, icQueue] = await Promise.all([
    safeCommandCenter(),
    safeRecentActivity(),
    safeTickets(),
    safeLeads(),
    safeDeals(),
    safeIc(),
  ]);

  if (snap) {
    base.commandCenter = {
      freshness: snap.freshness,
      period: snap.period,
      funnel: snap.funnel,
      attentionRequired: snap.attention_required,
      activePortfolioCompanies: snap.active_portfolio_companies,
      portfolioHealth: snap.portfolio_health,
      capital: {
        portfolioArrK: snap.capital.portfolio_arr_k,
        minRunwayMo: snap.capital.min_runway_mo,
        runwayBreach: snap.capital.runway_breach,
        consolidatedCashK: snap.capital.consolidated_cash_k,
      },
    };
    base.riskSignals = {
      attentionRequired: snap.attention_required,
      runwayBreach: snap.capital.runway_breach,
      blockedDdTasks: snap.funnel.blocked_dd_tasks,
      dealsInClosing: snap.funnel.deals_in_closing,
    };
  } else {
    base.commandCenter = { unavailable: true };
  }

  const openTickets = tickets.filter(
    (t) => !['Closed', 'Resolved'].includes(t.status),
  );
  const overdueTickets = openTickets
    .filter((t) => t.sla_due_at && new Date(t.sla_due_at).getTime() < Date.now())
    .slice(0, 5)
    .map((t) => ({
      title: t.title,
      service: t.service,
      priority: t.priority,
      company: entityDisplayName({
        company_name: t.company_name,
        entity_id: t.entity_id,
      }),
    }));

  const icPending = icQueue.filter(
    (r) => r.status === 'Pending' || r.status === 'In Review',
  ).length;

  base.counts = {
    openSsTickets: openTickets.length,
    overdueSsTickets: overdueTickets.length,
    activeLeads: leads.length,
    activeDeals: deals.length,
    icPending,
    recentActivity: activity.count,
  };

  base.queues = {
    overdueServiceItems: overdueTickets,
    topOpenTickets: openTickets.slice(0, 5).map((t) => ({
      title: t.title,
      service: t.service,
      priority: t.priority,
      company: entityDisplayName({
        company_name: t.company_name,
        entity_id: t.entity_id,
      }),
    })),
    leadStages: summarizeBy(leads.map((l) => l.stage ?? 'Unknown')),
    dealStages: summarizeBy(deals.map((d) => d.exec_stage ?? 'Unknown')),
  };

  if (activity.titles.length > 0) {
    base.recentActivityTitles = activity.titles;
  }

  return base;
}

function summarizeBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

async function safeCommandCenter() {
  try {
    return await getCommandCenterSnapshot();
  } catch (e) {
    console.warn(
      '[think-tank:tage] command center snapshot unavailable',
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

async function safeRecentActivity(): Promise<{
  count: number;
  titles: string[];
}> {
  try {
    const result = await listRecentActivity(8);
    if (!result.ok) return { count: 0, titles: [] };
    return {
      count: result.events.length,
      titles: result.events.slice(0, 5).map((e) => e.title),
    };
  } catch {
    return { count: 0, titles: [] };
  }
}

async function safeTickets() {
  try {
    return await listScopedTickets();
  } catch {
    return [];
  }
}

async function safeLeads() {
  try {
    return await listScopedActiveLeads();
  } catch {
    return [];
  }
}

async function safeDeals() {
  try {
    return await listScopedActiveDeals();
  } catch {
    return [];
  }
}

async function safeIc() {
  try {
    return await listScopedIcQueue();
  } catch {
    return [];
  }
}
