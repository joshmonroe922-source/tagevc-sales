/** Firm operating home — assemble parent snapshot from existing OS sources. */

import { listRecentActivity } from '@/lib/data/activity';
import {
  getCommandCenterSnapshot,
  listActivePortfolioCompanies,
} from '@/lib/data/repositories';
import { listSubsidiaryEntities } from '@/lib/data/entity-os';
import {
  hydrateTicketStore,
  listTickets,
} from '@/lib/data/ticket-store';
import { entityDisplayName } from '@/lib/entities/display-name';
import { getFirmOpsCommandPhase61Report } from '@/lib/firm-ops/firm-ops-command-phase61-server';
import { listEmployees } from '@/lib/hris/employees';
import { getSscHubGlance } from '@/lib/shared-services/ssc-checklist/hub-glance';

export type FirmHomeSnapshot = {
  company_count: number;
  subsidiary_count: number;
  open_leads: number;
  open_deals: number;
  hris_onboarding: number;
  ssc_overdue: number;
  ssc_completion_pct: number;
  draft_approvals: number;
  p0_risks: number;
  escalated_tickets: number;
  companies: Array<{
    id: string;
    name: string;
    entity_id: string;
    href: string;
  }>;
  subsidiaries: Array<{
    entity_id: string;
    name: string;
    href: string;
  }>;
  leadership: Array<{
    id: string;
    title: string;
    href: string;
    audience: string;
    count: number;
  }>;
  activity: Array<{
    id: string;
    title: string;
    created_at: string;
    href?: string | null;
  }>;
  capital: {
    portfolio_cash_k: number | null;
    firm_cash_k: number | null;
    min_runway_months: number | null;
  };
  /** Firm-visible assets only — never private I-quadrant. */
  firm_aum: {
    total: number;
    label: string;
    asset_count: number;
    freshest_as_of: string | null;
  };
};

export async function getFirmHomeSnapshot(): Promise<FirmHomeSnapshot> {
  await hydrateTicketStore({ forceSql: true }).catch(() => undefined);

  const [
    snap,
    companies,
    subsidiaries,
    firmOps,
    ssc,
    hris,
    activityResult,
  ] = await Promise.all([
    getCommandCenterSnapshot(),
    listActivePortfolioCompanies(),
    listSubsidiaryEntities(),
    getFirmOpsCommandPhase61Report(),
    getSscHubGlance().catch(() => null),
    listEmployees({ limit: 80 }),
    listRecentActivity(10),
  ]);

  const { getFirmAumSnapshot } = await import('@/lib/net-worth/assets');
  const firmAum = await getFirmAumSnapshot().catch(() => ({
    total: 0,
    label: 'Firm AUM · operating & real estate',
    asset_count: 0,
    freshest_as_of: null as string | null,
    by_class: [],
    excludes_private_i_quadrant: true as const,
  }));

  const tickets = listTickets().filter(
    (t) => t.status !== 'Closed' && t.status !== 'Resolved',
  );
  const draft_approvals = tickets.filter(
    (t) =>
      t.autonomy_band === 'DRAFT' && t.draft_approval === 'pending',
  ).length;
  const p0_risks = tickets.filter((t) => t.priority === 'P0').length;
  const escalated_tickets = tickets.filter(
    (t) => t.autonomy_band === 'ESCALATE' || t.priority === 'P0',
  ).length;

  const hris_onboarding = hris.rows.filter(
    (e) =>
      e.status === 'onboarding' ||
      e.onboarding_status === 'in_progress' ||
      e.onboarding_status === 'blocked',
  ).length;

  const leadership = firmOps.queues.flatMap((q) =>
    (q.queue_items ?? []).slice(0, 3).map((item) => ({
      id: `${q.audience}-${item.id}`,
      title: item.title,
      href: item.href,
      audience: String(q.audience),
      count: item.count,
    })),
  );

  const companyCards = companies.slice(0, 8).map((c) => ({
    id: c.id,
    name: c.company_name || entityDisplayName(c.entity_id),
    entity_id: c.entity_id,
    href: `/portfolio/${c.portfolio_id || c.id}`,
  }));

  const subsidiaryCards = subsidiaries.slice(0, 8).map((e) => ({
    entity_id: e.entity_id,
    name: entityDisplayName({
      entity_id: e.entity_id,
      canonical_name: e.canonical_name,
    }),
    href: `/entities/${e.entity_id}`,
  }));

  return {
    company_count: companies.length,
    subsidiary_count: subsidiaries.length,
    open_leads: snap.funnel.active_leads,
    open_deals: snap.funnel.active_deals,
    hris_onboarding,
    ssc_overdue: ssc?.overdue_tasks ?? 0,
    ssc_completion_pct: ssc?.completion_pct ?? 0,
    draft_approvals,
    p0_risks,
    escalated_tickets,
    companies: companyCards,
    subsidiaries: subsidiaryCards,
    leadership: leadership.slice(0, 8),
    activity: activityResult.events.map((ev) => ({
      id: ev.id,
      title: ev.title,
      created_at: ev.created_at,
      href:
        ev.ref_type === 'lead' && ev.ref_id
          ? `/deal-flow/vc/leads/${ev.ref_id}`
          : ev.ref_type === 'ticket' && ev.ref_id
            ? `/shared-services/tickets/${ev.ref_id}`
            : ev.entity_id
              ? `/entities/${ev.entity_id}`
              : '/activity',
    })),
    capital: {
      portfolio_cash_k: snap.capital.portfolio_cash_k ?? null,
      firm_cash_k: snap.capital.firm_cash_k ?? null,
      min_runway_months: snap.capital.min_runway_mo ?? null,
    },
    firm_aum: {
      total: firmAum.total,
      label: firmAum.label,
      asset_count: firmAum.asset_count,
      freshest_as_of: firmAum.freshest_as_of,
    },
  };
}
