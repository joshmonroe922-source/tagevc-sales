import { listRecentActivity } from '@/lib/data/activity';
import { getCommandCenterSnapshot } from '@/lib/data/repositories';
import type { SessionContext } from '@/lib/rbac/session';
import { createClient } from '@/lib/supabase/server';
import { APP_ROLE_LABELS } from '@/lib/types/roles';

const OPEN_TICKET_STATUSES = ['Open', 'In Progress', 'Blocked'] as const;

/** Compact, privacy-aware Tage OS context for Think Tank. Fails soft. */
export async function collectTageThinkTankContext(
  session: SessionContext,
): Promise<Record<string, unknown>> {
  const entityId = session.profile.entity_id ?? 'ENT-FIRM';
  const base: Record<string, unknown> = {
    portal: 'tage',
    entityId,
    realRole: session.realRole,
    effectiveRole: session.profile.role,
    impersonatingAs: session.impersonatingAs,
    impersonatingAsLabel: session.impersonatingAs
      ? APP_ROLE_LABELS[session.impersonatingAs]
      : null,
    goalsHint:
      'If personal KPIs are not stored, help define today/this-week goals from funnel, tickets, and portfolio attention.',
  };

  const [snap, activity, openTickets] = await Promise.all([
    safeCommandCenter(),
    safeRecentActivity(),
    safeOpenTicketCount(),
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

  base.counts = {
    openSsTickets: openTickets,
    recentActivity: activity.count,
  };

  if (activity.titles.length > 0) {
    base.recentActivityTitles = activity.titles;
  }

  return base;
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

async function safeOpenTicketCount(): Promise<number | null> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from('os_tickets')
      .select('id', { count: 'exact', head: true })
      .in('status', [...OPEN_TICKET_STATUSES]);
    if (error) {
      console.warn('[think-tank:tage] open tickets count', error.message);
      return null;
    }
    return count ?? 0;
  } catch {
    return null;
  }
}
