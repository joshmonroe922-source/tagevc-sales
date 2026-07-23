import { ensureMasterData } from '@/lib/data/master-data';
import { listDocuments } from '@/lib/data/document-store';
import {
  getDealFlowStore,
  listLeadsForEntity,
  listTasksForDeal,
  listTasksForLead,
} from '@/lib/data/deal-flow-store';
import {
  getMaStore,
  listTasksForMa,
} from '@/lib/data/ma-store';
import {
  getReStore,
  listTasksForRe,
} from '@/lib/data/re-store';
import { listTickets } from '@/lib/data/ticket-store';
import type {
  EntityLinkedTask,
  EntityOperatingView,
} from '@/lib/types';

function openStatuses(status: string): boolean {
  return status !== 'Completed' && status !== 'Resolved' && status !== 'Closed';
}

/**
 * Subsidiary Operating System aggregate.
 * Pulls Entity Master + Portfolio Active + CORE/FLEX KPIs + docs + tickets +
 * leads + deal-flow / SS tasks for one entity_id.
 */
export async function getEntityOperatingView(
  entityId: string,
): Promise<EntityOperatingView | null> {
  const { getEntityById } = await import('@/lib/data/repositories');
  const allowed = await getEntityById(entityId);
  if (!allowed) return null;

  const master = await ensureMasterData();
  const entity = master.entities.find((e) => e.entity_id === entityId) ?? null;
  if (!entity) return null;

  const portfolio =
    master.companies.find((c) => c.entity_id === entityId) ?? null;
  const period = master.period;
  const pnl =
    master.pnl.find(
      (r) => r.entity_id === entityId && r.period === period,
    ) ?? null;
  const core_kpis = master.coreKpis.filter(
    (k) => k.entity_id === entityId && k.period === period,
  );
  const flex_kpis = master.flexKpis.filter(
    (k) => k.entity_id === entityId && k.period === period,
  );

  const documents = listDocuments(entityId);
  const tickets = listTickets().filter(
    (t) =>
      t.entity_id === entityId ||
      (t.company_name &&
        t.company_name.trim().toLowerCase() ===
          entity.canonical_name.trim().toLowerCase()),
  );

  const leads = listLeadsForEntity(entityId, entity.canonical_name);

  const df = getDealFlowStore();
  const deals = df.deals.filter(
    (d) =>
      d.entity_id === entityId ||
      d.company_name.trim().toLowerCase() ===
        entity.canonical_name.trim().toLowerCase() ||
      (portfolio?.deal_id != null && d.deal_id === portfolio.deal_id),
  );

  const ma = getMaStore();
  const ma_targets = ma.targets.filter(
    (t) =>
      t.entity_id === entityId ||
      t.company_name.trim().toLowerCase() ===
        entity.canonical_name.trim().toLowerCase(),
  );

  const re = getReStore();
  const re_deals = re.deals.filter(
    (d) =>
      d.entity_id === entityId ||
      d.asset_name.trim().toLowerCase() ===
        entity.canonical_name.trim().toLowerCase(),
  );

  const dealFlowTasks: EntityLinkedTask[] = [];

  for (const lead of leads) {
    for (const t of listTasksForLead(lead.lead_id)) {
      if (!openStatuses(t.status)) continue;
      dealFlowTasks.push({
        task_id: t.task_id,
        title: t.title,
        track: 'VC Lead',
        parent_id: lead.lead_id,
        process_stage: t.process_stage,
        priority: t.priority,
        status: t.status,
        owner: t.owner,
        due_date: t.due_date,
        href: `/deal-flow/vc/leads/${lead.lead_id}`,
      });
    }
  }

  for (const deal of deals) {
    for (const t of listTasksForDeal(deal.deal_id)) {
      if (!openStatuses(t.status)) continue;
      dealFlowTasks.push({
        task_id: t.task_id,
        title: t.title,
        track: 'VC Deal',
        parent_id: deal.deal_id,
        process_stage: t.process_stage,
        priority: t.priority,
        status: t.status,
        owner: t.owner,
        due_date: t.due_date,
        href: `/deal-flow/vc/deals/${deal.deal_id}`,
      });
    }
  }

  for (const target of ma_targets) {
    for (const t of listTasksForMa(target.ma_id)) {
      if (!openStatuses(t.status)) continue;
      dealFlowTasks.push({
        task_id: t.task_id,
        title: t.title,
        track: 'M&A',
        parent_id: target.ma_id,
        process_stage: t.process_stage,
        priority: t.priority,
        status: t.status,
        owner: t.owner,
        due_date: t.due_date,
        href: `/deal-flow/ma/${target.ma_id}`,
      });
    }
  }

  for (const rd of re_deals) {
    for (const t of listTasksForRe(rd.re_id)) {
      if (!openStatuses(t.status)) continue;
      dealFlowTasks.push({
        task_id: t.task_id,
        title: t.title,
        track: 'RE',
        parent_id: rd.re_id,
        process_stage: t.process_stage,
        priority: t.priority,
        status: t.status,
        owner: t.owner,
        due_date: t.due_date,
        href: `/deal-flow/re/${rd.re_id}`,
      });
    }
  }

  const sharedServicesTasks: EntityLinkedTask[] = tickets
    .filter((t) => openStatuses(t.status))
    .map((t) => ({
      task_id: t.ticket_id,
      title: t.title,
      track: 'Shared Services' as const,
      parent_id: t.ticket_id,
      process_stage: t.service,
      priority: t.priority,
      status: t.status,
      owner: t.assignee_name ?? t.requester_name,
      due_date: t.sla_due_at,
      href: `/shared-services/tickets/${t.ticket_id}`,
    }));

  const origin =
    leads.find((l) => l.archived_at && l.source) ??
    leads.find((l) => l.source === 'Inbound') ??
    leads[0] ??
    null;

  const { listFinancialAuditsForEntity } = await import(
    '@/lib/data/normalized/portfolio-repo'
  );
  const financial_audits = await listFinancialAuditsForEntity(entityId, 20);

  let subsidiary_rollup = null;
  if (entityId === 'ENT-R619') {
    const { getSubsidiaryRollupPhase53Report } = await import(
      '@/lib/data/subsidiary-rollup-phase53'
    );
    subsidiary_rollup = await getSubsidiaryRollupPhase53Report(entityId);
  }

  return {
    entity,
    portfolio,
    period,
    pnl,
    core_kpis,
    flex_kpis,
    documents,
    tickets,
    leads,
    deals,
    ma_targets,
    re_deals,
    tasks: {
      deal_flow: dealFlowTasks,
      shared_services: sharedServicesTasks,
    },
    origin_source: origin?.source
      ? `${origin.source}${origin.source_detail ? ` · ${origin.source_detail}` : ''}`
      : null,
    financial_audits,
    subsidiary_rollup,
  };
}

export async function listSubsidiaryEntities() {
  const { listEntities } = await import('@/lib/data/repositories');
  const entities = await listEntities();
  return entities
    .filter(
      (e) =>
        e.entity_type === 'Subsidiary' || e.entity_type === 'RE Asset Entity',
    )
    .sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
}
