import { randomUUID } from 'crypto';
import {
  applyLeadDealLinks,
  buildInitialDealTasks,
  buildInitialTasks,
  INITIAL_DEALS,
  INITIAL_IC_AUDITS,
  INITIAL_IC_REVIEWS,
  INITIAL_LEADS,
} from '@/lib/data/deal-flow-seed';
import { createBroadcastNotification, logActivity } from '@/lib/data/activity';
import {
  fetchAllLeadTasks,
  fetchAllLeads,
  syncLeadsAndTasks,
} from '@/lib/data/normalized/leads-repo';
import {
  fetchAllDealTasks,
  fetchAllDeals,
  syncDealsAndTasks,
} from '@/lib/data/normalized/deals-repo';
import {
  fetchAllIcReviews,
  syncIcReviews,
} from '@/lib/data/normalized/ic-repo';
import {
  fetchAllIcAudits,
  syncIcAudits,
} from '@/lib/data/normalized/audits-repo';
import {
  fetchAllHandoffs,
  filterHandoffsByTrack,
  syncHandoffs,
} from '@/lib/data/normalized/handoffs-repo';
import {
  preferNormalizedTables,
  queueNormalizedSync,
  shouldUseNormalizedRows,
} from '@/lib/data/normalized/sync';
import {
  isStoreHydrated,
  loadStoreSnapshot,
  markStoreHydrated,
  queueStorePersist,
  saveStoreSnapshot,
  shouldLoadSnapshotPayload,
} from '@/lib/data/persist';
import { createHandoffPack } from '@/lib/deal-flow/handoff';
import { spawnTasksForStage } from '@/lib/deal-flow/spawn-tasks';
import { isReadyForDealConversion } from '@/lib/deal-flow/stage';
import {
  requiresIcApproval,
} from '@/lib/deal-flow/vc/exec-stage';
import { spawnDealTasksForStage } from '@/lib/deal-flow/vc/spawn-deal-tasks';
import type {
  Deal,
  DealPath,
  DealTask,
  ExecStage,
  HandoffPack,
  IcAuditEvent,
  IcDecision,
  IcReview,
  Lead,
  LeadTask,
  PipelineStage,
  Priority,
  TaskStatus,
  ThesisFit,
} from '@/lib/types';

type DealFlowStore = {
  leads: Lead[];
  tasks: LeadTask[];
  deals: Deal[];
  dealTasks: DealTask[];
  icReviews: IcReview[];
  icAudits: IcAuditEvent[];
  handoffs: HandoffPack[];
};

declare global {
  var __tageDealFlowStore: DealFlowStore | undefined;
}

function createStore(): DealFlowStore {
  return {
    leads: applyLeadDealLinks(structuredClone(INITIAL_LEADS)),
    tasks: buildInitialTasks(),
    deals: structuredClone(INITIAL_DEALS),
    dealTasks: buildInitialDealTasks(),
    icReviews: structuredClone(INITIAL_IC_REVIEWS),
    icAudits: structuredClone(INITIAL_IC_AUDITS),
    handoffs: [],
  };
}

export function getDealFlowStore(): DealFlowStore {
  if (!globalThis.__tageDealFlowStore) {
    globalThis.__tageDealFlowStore = createStore();
  }
  return globalThis.__tageDealFlowStore;
}

function touchDealFlow() {
  const getPayload = () => structuredClone(getDealFlowStore());
  queueStorePersist('deal_flow', getPayload);
  queueNormalizedSync('os_leads', async () => {
    const store = getDealFlowStore();
    await syncLeadsAndTasks(store.leads, store.tasks);
  });
  queueNormalizedSync('os_deals', async () => {
    const store = getDealFlowStore();
    await syncDealsAndTasks(store.deals, store.dealTasks);
  });
  queueNormalizedSync('os_ic_reviews', async () => {
    const store = getDealFlowStore();
    await syncIcReviews(store.icReviews);
  });
  queueNormalizedSync('os_ic_audits', async () => {
    const store = getDealFlowStore();
    await syncIcAudits(store.icAudits);
  });
  queueNormalizedSync('os_handoffs_vc', async () => {
    const store = getDealFlowStore();
    await syncHandoffs(store.handoffs);
  });
}

export async function hydrateDealFlowStore() {
  if (isStoreHydrated('deal_flow')) return;

  const readGate = shouldLoadSnapshotPayload('deal_flow');
  if (readGate.allow) {
    const snap = await loadStoreSnapshot<DealFlowStore>('deal_flow');
    if (snap?.payload?.leads) {
      globalThis.__tageDealFlowStore = snap.payload;
    } else {
      const store = getDealFlowStore();
      await saveStoreSnapshot('deal_flow', store);
    }
  }
  // else Stage 4b: keep in-memory seed; SQL overlay below

  const store = getDealFlowStore();
  const [sqlLeads, sqlTasks, sqlDeals, sqlDealTasks, sqlIc, sqlIcAudits, sqlHandoffs] =
    await Promise.all([
      fetchAllLeads(),
      fetchAllLeadTasks(),
      fetchAllDeals(),
      fetchAllDealTasks(),
      fetchAllIcReviews(),
      fetchAllIcAudits(),
      fetchAllHandoffs(),
    ]);

  // Prefer normalized rows when present (or forced via USE_NORMALIZED_TABLES).
  // Empty SQL is authoritative — do not resurrect seed/snapshot demo leads.
  if (sqlLeads !== null) {
    if (sqlLeads.length > 0 || preferNormalizedTables()) {
      store.leads = sqlLeads;
      if (sqlTasks != null && (sqlTasks.length > 0 || preferNormalizedTables())) {
        store.tasks = sqlTasks;
      }
    } else {
      store.leads = [];
      if (sqlTasks != null) store.tasks = sqlTasks;
    }
  }

  if (shouldUseNormalizedRows(sqlDeals)) {
    if (sqlDeals.length > 0) store.deals = sqlDeals;
    if (sqlDealTasks && sqlDealTasks.length > 0) store.dealTasks = sqlDealTasks;
  } else if (sqlDeals !== null && store.deals.length > 0) {
    await syncDealsAndTasks(store.deals, store.dealTasks);
  }

  if (shouldUseNormalizedRows(sqlIc)) {
    if (sqlIc.length > 0) store.icReviews = sqlIc;
  } else if (sqlIc !== null && store.icReviews.length > 0) {
    await syncIcReviews(store.icReviews);
  }

  if (shouldUseNormalizedRows(sqlIcAudits)) {
    if (sqlIcAudits.length > 0) store.icAudits = sqlIcAudits;
  } else if (sqlIcAudits !== null && store.icAudits.length > 0) {
    await syncIcAudits(store.icAudits);
  }

  const vcHandoffs = sqlHandoffs
    ? filterHandoffsByTrack(sqlHandoffs, 'VC Invest')
    : null;
  if (shouldUseNormalizedRows(vcHandoffs)) {
    if (vcHandoffs.length > 0) store.handoffs = vcHandoffs;
  } else if (vcHandoffs !== null && store.handoffs.length > 0) {
    await syncHandoffs(store.handoffs);
  }

  markStoreHydrated('deal_flow');
}

export function resetDealFlowStore() {
  globalThis.__tageDealFlowStore = createStore();
  touchDealFlow();
}

function nextLeadId(leads: Lead[]): string {
  const max = leads.reduce((m, l) => {
    const n = Number(l.lead_id.replace(/\D/g, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `LD-${String(max + 1).padStart(3, '0')}`;
}

function nextDealId(deals: Deal[]): string {
  const max = deals.reduce((m, d) => {
    const n = Number(d.deal_id.replace(/\D/g, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `DE-${String(max + 1).padStart(3, '0')}`;
}

function nextIcId(reviews: IcReview[]): string {
  const max = reviews.reduce((m, r) => {
    const n = Number(r.ic_id.replace(/\D/g, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `IC-${String(max + 1).padStart(3, '0')}`;
}

function nextIcAuditId(audits: IcAuditEvent[]): string {
  const max = audits.reduce((m, a) => {
    const n = Number(a.event_id.replace(/\D/g, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `ICA-${String(max + 1).padStart(3, '0')}`;
}

export type CreateLeadInput = {
  company_name: string;
  website?: string;
  sector?: string;
  source?: string;
  source_detail?: string;
  owner?: string;
  priority?: Priority;
  raise_stage?: string;
  check_size_k?: number;
  location?: string;
  notes?: string;
  path?: DealPath | null;
  /** Optional link to portfolio / Entity Master (follow-on inbound). */
  related_entity_id?: string;
};

export function createLead(input: CreateLeadInput): Lead {
  const store = getDealFlowStore();
  const now = new Date().toISOString();
  const lead: Lead = {
    id: randomUUID(),
    lead_id: nextLeadId(store.leads),
    company_name: input.company_name.trim(),
    website: input.website?.trim() || null,
    sector: input.sector?.trim() || null,
    source: input.source?.trim() || 'Other',
    source_detail: input.source_detail?.trim() || null,
    stage: 'Sourced',
    priority: input.priority ?? 'Medium',
    owner: input.owner?.trim() || 'Associate',
    next_action: 'Complete intake + evidence capture',
    next_action_date: null,
    thesis_fit: 'Unknown',
    score: null,
    raise_stage: input.raise_stage?.trim() || null,
    check_size_k: input.check_size_k ?? null,
    location: input.location?.trim() || null,
    path: input.path ?? null,
    notes: input.notes?.trim() || null,
    outcome: null,
    deal_id: null,
    related_entity_id: input.related_entity_id?.trim() || null,
    created_at: now,
    updated_at: now,
    archived_at: null,
  };
  store.leads.push(lead);
  const spawned = spawnTasksForStage(lead, store.tasks, 'Sourced');
  store.tasks.push(...spawned);
  touchDealFlow();
  void logActivity({
    module: 'vc',
    action: 'lead_created',
    title: `Lead created: ${lead.company_name}`,
    ref_type: 'lead',
    ref_id: lead.lead_id,
    entity_id: lead.related_entity_id ?? undefined,
  });
  void createBroadcastNotification({
    kind: 'new_lead',
    title: `New lead: ${lead.company_name}`,
    body: `Source: ${lead.source}`,
    href: `/deal-flow/vc/leads/${lead.lead_id}`,
  });
  return lead;
}

export function updateLeadStage(
  leadId: string,
  stage: PipelineStage,
): { lead: Lead; spawned: LeadTask[] } {
  const store = getDealFlowStore();
  const lead = store.leads.find((l) => l.lead_id === leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  const now = new Date().toISOString();
  lead.stage = stage;
  lead.updated_at = now;
  const spawned = spawnTasksForStage(lead, store.tasks, stage);
  store.tasks.push(...spawned);
  touchDealFlow();
  void logActivity({
    module: 'vc',
    action: 'lead_stage',
    title: `${lead.company_name} → ${stage}`,
    ref_type: 'lead',
    ref_id: lead.lead_id,
  });
  return { lead, spawned };
}

export function updateLeadFields(
  leadId: string,
  patch: Partial<
    Pick<
      Lead,
      | 'next_action'
      | 'next_action_date'
      | 'owner'
      | 'priority'
      | 'thesis_fit'
      | 'score'
      | 'notes'
      | 'check_size_k'
    >
  >,
): Lead {
  const store = getDealFlowStore();
  const lead = store.leads.find((l) => l.lead_id === leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  Object.assign(lead, patch, { updated_at: new Date().toISOString() });
  touchDealFlow();
  return lead;
}

export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
): LeadTask {
  const store = getDealFlowStore();
  const task = store.tasks.find((t) => t.task_id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  const now = new Date().toISOString();
  task.status = status;
  task.updated_at = now;
  task.completed_at = status === 'Completed' ? now : null;
  touchDealFlow();
  return task;
}

/**
 * Convert Ready for DD lead → Deal Active at IC Approved.
 * Creates pending IC review + spawns Deal Process Library tasks.
 */
export function convertLeadToDeal(leadId: string): Deal {
  const store = getDealFlowStore();
  const lead = store.leads.find((l) => l.lead_id === leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  if (!isReadyForDealConversion(lead.stage)) {
    throw new Error('Lead must be at Ready for DD to open Deal Active');
  }
  if (lead.deal_id) {
    const existing = store.deals.find((d) => d.deal_id === lead.deal_id);
    if (existing) return existing;
  }

  const now = new Date().toISOString();
  const deal: Deal = {
    id: randomUUID(),
    deal_id: nextDealId(store.deals),
    lead_id: lead.lead_id,
    company_name: lead.company_name,
    entity_id: null,
    exec_stage: 'IC Approved',
    priority: lead.priority,
    instrument: null,
    premoney_m: null,
    check_k: lead.check_size_k,
    ownership_pct: null,
    counsel: 'Firm Counsel',
    path: lead.path,
    outcome: null,
    owner: lead.owner ?? 'Partner',
    next_action: 'Finalize IC memo with DD findings and recommendation',
    handoff_id: null,
    created_at: now,
    updated_at: now,
    archived_at: null,
  };
  store.deals.push(deal);
  lead.deal_id = deal.deal_id;
  lead.outcome = 'Advanced to DD';
  lead.updated_at = now;

  const spawned = spawnDealTasksForStage(deal, store.dealTasks, 'IC Approved');
  store.dealTasks.push(...spawned);

  const ic: IcReview = {
    id: randomUUID(),
    ic_id: nextIcId(store.icReviews),
    deal_id: deal.deal_id,
    company_name: deal.company_name,
    status: 'Pending',
    decision: null,
    conditions: null,
    recommendation: null,
    decided_by: null,
    decided_at: null,
    created_at: now,
    updated_at: now,
  };
  store.icReviews.push(ic);
  store.icAudits.push({
    id: randomUUID(),
    event_id: nextIcAuditId(store.icAudits),
    ic_id: ic.ic_id,
    deal_id: deal.deal_id,
    action: 'opened',
    decision: null,
    detail: `IC review opened for ${deal.deal_id}`,
    actor: 'system',
    created_at: now,
  });

  touchDealFlow();
  void logActivity({
    module: 'vc',
    action: 'deal_opened',
    title: `Deal opened: ${deal.company_name}`,
    ref_type: 'deal',
    ref_id: deal.deal_id,
  });
  return deal;
}

export function updateDealExecStage(
  dealId: string,
  stage: ExecStage,
): { deal: Deal; spawned: DealTask[] } {
  const store = getDealFlowStore();
  const deal = store.deals.find((d) => d.deal_id === dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);

  if (requiresIcApproval(deal.exec_stage, stage)) {
    const ic = store.icReviews.find((r) => r.deal_id === dealId);
    const approved =
      ic?.status === 'Decided' &&
      (ic.decision === 'Approve' || ic.decision === 'Approve with conditions');
    if (!approved) {
      throw new Error(
        'IC must Approve (or Approve with conditions) before leaving IC Approved',
      );
    }
  }

  const now = new Date().toISOString();
  deal.exec_stage = stage;
  deal.updated_at = now;
  if (stage === 'Wired / Closed') {
    deal.outcome = 'Wired / Closed';
    deal.next_action = 'Complete Portfolio Handoff pack';
  }

  const spawned = spawnDealTasksForStage(deal, store.dealTasks, stage);
  store.dealTasks.push(...spawned);

  if (stage === 'Wired / Closed' || stage === 'Post-Close') {
    ensureVcHandoff(deal);
  }

  touchDealFlow();
  void logActivity({
    module: 'vc',
    action: 'deal_stage',
    title: `${deal.company_name} → ${stage}`,
    ref_type: 'deal',
    ref_id: deal.deal_id,
  });
  return { deal, spawned };
}

function ensureVcHandoff(deal: Deal): HandoffPack {
  const store = getDealFlowStore();
  if (deal.handoff_id) {
    const existing = store.handoffs.find((h) => h.handoff_id === deal.handoff_id);
    if (existing) return existing;
  }
  const pack = createHandoffPack({
    track: 'VC Invest',
    source_id: deal.deal_id,
    company_name: deal.company_name,
    path: deal.path,
    existing: store.handoffs,
  });
  store.handoffs.push(pack);
  deal.handoff_id = pack.handoff_id;
  deal.updated_at = new Date().toISOString();
  touchDealFlow();
  return pack;
}

export function updateDealTaskStatus(
  taskId: string,
  status: TaskStatus,
): DealTask {
  const store = getDealFlowStore();
  const task = store.dealTasks.find((t) => t.task_id === taskId);
  if (!task) throw new Error(`Deal task ${taskId} not found`);
  const now = new Date().toISOString();
  task.status = status;
  task.updated_at = now;
  task.completed_at = status === 'Completed' ? now : null;
  touchDealFlow();
  return task;
}

export type RecordIcDecisionInput = {
  icId: string;
  decision: IcDecision;
  conditions?: string;
  recommendation?: string;
  actor?: string;
};

export function recordIcDecision(input: RecordIcDecisionInput): IcReview {
  const store = getDealFlowStore();
  const review = store.icReviews.find((r) => r.ic_id === input.icId);
  if (!review) throw new Error(`IC ${input.icId} not found`);

  const now = new Date().toISOString();
  const actor = input.actor?.trim() || 'Partner';
  review.status = 'Decided';
  review.decision = input.decision;
  review.conditions =
    input.decision === 'Approve with conditions'
      ? (input.conditions?.trim() || 'Conditions to be documented')
      : input.conditions?.trim() || null;
  review.recommendation = input.recommendation?.trim() || null;
  review.decided_by = actor;
  review.decided_at = now;
  review.updated_at = now;

  store.icAudits.push({
    id: randomUUID(),
    event_id: nextIcAuditId(store.icAudits),
    ic_id: review.ic_id,
    deal_id: review.deal_id,
    action: 'decision',
    decision: input.decision,
    detail:
      review.conditions ??
      input.recommendation?.trim() ??
      `IC decision: ${input.decision}`,
    actor,
    created_at: now,
  });

  const deal = store.deals.find((d) => d.deal_id === review.deal_id);
  if (deal) {
    if (input.decision === 'Pass') {
      deal.outcome = 'Dead';
      deal.next_action = 'Archive Deal Closed — IC Pass';
      deal.updated_at = now;
    } else if (input.decision === 'Defer') {
      review.status = 'In Review';
      deal.next_action = 'IC deferred — gather additional materials';
      deal.updated_at = now;
    } else if (
      input.decision === 'Approve' ||
      input.decision === 'Approve with conditions'
    ) {
      deal.next_action =
        input.decision === 'Approve with conditions'
          ? 'Advance to Term Sheet; track IC conditions'
          : 'Draft term sheet; partner approve economics';
      deal.updated_at = now;
    }
  }

  touchDealFlow();
  void logActivity({
    module: 'vc',
    action: 'ic_decision',
    title: `IC ${input.decision}: ${review.company_name}`,
    ref_type: 'ic',
    ref_id: review.ic_id,
  });
  return review;
}

export function submitIcForReview(dealId: string): IcReview {
  const store = getDealFlowStore();
  const deal = store.deals.find((d) => d.deal_id === dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);
  let review = store.icReviews.find((r) => r.deal_id === dealId);
  const now = new Date().toISOString();
  if (!review) {
    review = {
      id: randomUUID(),
      ic_id: nextIcId(store.icReviews),
      deal_id: deal.deal_id,
      company_name: deal.company_name,
      status: 'In Review',
      decision: null,
      conditions: null,
      recommendation: null,
      decided_by: null,
      decided_at: null,
      created_at: now,
      updated_at: now,
    };
    store.icReviews.push(review);
  } else if (review.status === 'Pending') {
    review.status = 'In Review';
    review.updated_at = now;
  }
  store.icAudits.push({
    id: randomUUID(),
    event_id: nextIcAuditId(store.icAudits),
    ic_id: review.ic_id,
    deal_id: dealId,
    action: 'submitted',
    decision: null,
    detail: 'Submitted to IC queue',
    actor: deal.owner ?? 'Partner',
    created_at: now,
  });
  touchDealFlow();
  return review;
}

export function listActiveLeads(): Lead[] {
  return getDealFlowStore()
    .leads.filter((l) => !l.archived_at)
    .sort((a, b) => a.company_name.localeCompare(b.company_name));
}

/** All leads including archived (entity OS / intake history). */
export function listAllLeads(): Lead[] {
  return getDealFlowStore()
    .leads.slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function listLeadsForEntity(entityId: string, companyName?: string): Lead[] {
  const name = companyName?.trim().toLowerCase();
  return listAllLeads().filter((l) => {
    if (l.related_entity_id === entityId) return true;
    if (name && l.company_name.trim().toLowerCase() === name) return true;
    return false;
  });
}

export function getLead(leadId: string): Lead | null {
  return getDealFlowStore().leads.find((l) => l.lead_id === leadId) ?? null;
}

export function listTasksForLead(leadId: string): LeadTask[] {
  return getDealFlowStore()
    .tasks.filter((t) => t.lead_id === leadId)
    .sort((a, b) => a.task_id.localeCompare(b.task_id));
}

export function listOpenLeadTasks(): LeadTask[] {
  return getDealFlowStore().tasks.filter((t) => t.status !== 'Completed');
}

export function listActiveDeals(): Deal[] {
  return getDealFlowStore()
    .deals.filter((d) => !d.archived_at)
    .sort((a, b) => a.company_name.localeCompare(b.company_name));
}

export function getDeal(dealId: string): Deal | null {
  return getDealFlowStore().deals.find((d) => d.deal_id === dealId) ?? null;
}

export function listTasksForDeal(dealId: string): DealTask[] {
  return getDealFlowStore()
    .dealTasks.filter((t) => t.deal_id === dealId)
    .sort((a, b) => a.task_id.localeCompare(b.task_id));
}

export function listIcQueue(): IcReview[] {
  return getDealFlowStore()
    .icReviews.slice()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function getIcReview(icId: string): IcReview | null {
  return getDealFlowStore().icReviews.find((r) => r.ic_id === icId) ?? null;
}

export function getIcForDeal(dealId: string): IcReview | null {
  return getDealFlowStore().icReviews.find((r) => r.deal_id === dealId) ?? null;
}

export function listIcAuditsForDeal(dealId: string): IcAuditEvent[] {
  return getDealFlowStore()
    .icAudits.filter((a) => a.deal_id === dealId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function listHandoffs(): HandoffPack[] {
  return getDealFlowStore()
    .handoffs.slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getHandoff(handoffId: string): HandoffPack | null {
  return (
    getDealFlowStore().handoffs.find((h) => h.handoff_id === handoffId) ?? null
  );
}

export type { ThesisFit };
