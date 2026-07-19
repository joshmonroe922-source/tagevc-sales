import type { Deal, DealTask, IcAuditEvent, IcReview, Lead } from '@/lib/types';
import { spawnTasksForStage } from '@/lib/deal-flow/spawn-tasks';
import { spawnDealTasksForStage } from '@/lib/deal-flow/vc/spawn-deal-tasks';
import { INITIAL_LEAD_TASKS, INITIAL_LEADS } from '@/lib/data/deal-flow-seed-leads';

export { INITIAL_LEADS, INITIAL_LEAD_TASKS };

const now = '2026-03-15T12:00:00.000Z';

/** Backfill missing stage templates for seeded leads (spawn-once). */
export function buildInitialTasks() {
  let tasks = [...INITIAL_LEAD_TASKS];
  for (const lead of INITIAL_LEADS) {
    const spawned = spawnTasksForStage(lead, tasks);
    tasks = [...tasks, ...spawned];
  }
  return tasks;
}

/**
 * Deal Active seeds from Excel.
 * DE-001 Orbit Data linked to LD-005; IC already passed.
 * DE-002 Example Advanced Co mid-docs.
 */
export const INITIAL_DEALS: Deal[] = [
  {
    id: '77777777-7777-4777-8777-777777777701',
    deal_id: 'DE-001',
    lead_id: 'LD-005',
    company_name: 'Orbit Data',
    entity_id: null,
    exec_stage: 'IC Approved',
    priority: 'Critical',
    instrument: 'Priced Equity',
    premoney_m: 45,
    check_k: 4000,
    ownership_pct: 0.12,
    counsel: 'Firm Counsel',
    path: null,
    outcome: null,
    owner: 'Partner',
    next_action: 'Draft term sheet; partner approve economics',
    handoff_id: null,
    created_at: '2026-03-22T12:00:00.000Z',
    updated_at: now,
    archived_at: null,
  },
  {
    id: '77777777-7777-4777-8777-777777777702',
    deal_id: 'DE-002',
    lead_id: 'LD-010',
    company_name: 'Example Advanced Co',
    entity_id: null,
    exec_stage: 'Docs Drafting',
    priority: 'Critical',
    instrument: 'Priced Equity',
    premoney_m: 28,
    check_k: 2500,
    ownership_pct: 0.1,
    counsel: 'Firm Counsel',
    path: null,
    outcome: null,
    owner: 'Partner',
    next_action: 'SPA markup round 2 with co counsel',
    handoff_id: null,
    created_at: '2026-03-10T12:00:00.000Z',
    updated_at: now,
    archived_at: null,
  },
  /**
   * Closed Launch deal for Instant NDA — linked to ENT-002 / PF-002.
   * Surfaces Post-Close tasks on Subsidiary OS.
   */
  {
    id: '77777777-7777-4777-8777-777777777703',
    deal_id: 'DE-LAU-01',
    lead_id: 'LD-006',
    company_name: 'Instant NDA',
    entity_id: 'ENT-002',
    exec_stage: 'Post-Close',
    priority: 'Medium',
    instrument: 'SAFE → Equity',
    premoney_m: 12,
    check_k: 2500,
    ownership_pct: 0.18,
    counsel: 'Firm Counsel',
    path: 'Launch',
    outcome: 'Wired / Closed',
    owner: 'Partner',
    next_action: 'Quarterly board pack + enterprise GTM review',
    handoff_id: 'PH-LAU-01',
    created_at: '2025-05-01T12:00:00.000Z',
    updated_at: now,
    archived_at: null,
  },
];

export const INITIAL_IC_REVIEWS: IcReview[] = [
  {
    id: '88888888-8888-4888-8888-888888888801',
    ic_id: 'IC-001',
    deal_id: 'DE-001',
    company_name: 'Orbit Data',
    status: 'Decided',
    decision: 'Approve',
    conditions: null,
    recommendation: 'Advance to term sheet — strong thesis, DD clean.',
    decided_by: 'Partner',
    decided_at: '2026-03-21T18:00:00.000Z',
    created_at: '2026-03-20T12:00:00.000Z',
    updated_at: '2026-03-21T18:00:00.000Z',
  },
  {
    id: '88888888-8888-4888-8888-888888888802',
    ic_id: 'IC-002',
    deal_id: 'DE-002',
    company_name: 'Example Advanced Co',
    status: 'Decided',
    decision: 'Approve with conditions',
    conditions: 'Board observer until Series B; bring-down financials at signing.',
    recommendation: 'Approved with conditions noted on Deal Active.',
    decided_by: 'Partner',
    decided_at: '2026-03-08T16:00:00.000Z',
    created_at: '2026-03-05T12:00:00.000Z',
    updated_at: '2026-03-08T16:00:00.000Z',
  },
];

export const INITIAL_IC_AUDITS: IcAuditEvent[] = [
  {
    id: '99999999-9999-4999-8999-999999999901',
    event_id: 'ICA-001',
    ic_id: 'IC-001',
    deal_id: 'DE-001',
    action: 'decision',
    decision: 'Approve',
    detail: 'IC passed 3/21 — no conditions.',
    actor: 'Partner',
    created_at: '2026-03-21T18:00:00.000Z',
  },
  {
    id: '99999999-9999-4999-8999-999999999902',
    event_id: 'ICA-002',
    ic_id: 'IC-002',
    deal_id: 'DE-002',
    action: 'decision',
    decision: 'Approve with conditions',
    detail: 'Board observer until Series B; bring-down at signing.',
    actor: 'Partner',
    created_at: '2026-03-08T16:00:00.000Z',
  },
];

/** Seed deal tasks for current exec stages (spawn-once). */
export function buildInitialDealTasks(): DealTask[] {
  let tasks: DealTask[] = [];
  for (const deal of INITIAL_DEALS) {
    // Spawn for current stage and all prior stages so desk is populated.
    const stagesToSeed =
      deal.exec_stage === 'Docs Drafting'
        ? ([
            'IC Approved',
            'Term Sheet',
            'Confirmatory DD',
            'Docs Drafting',
          ] as const)
        : ([deal.exec_stage] as const);
    for (const stage of stagesToSeed) {
      const spawned = spawnDealTasksForStage(deal, tasks, stage);
      tasks = [...tasks, ...spawned];
    }
  }
  // Mark Orbit IC tasks complete (IC already decided).
  for (const t of tasks) {
    if (
      t.deal_id === 'DE-001' &&
      (t.lib_id === 'DX-01' || t.lib_id === 'DX-02' || t.lib_id === 'DX-03')
    ) {
      t.status = 'Completed';
      t.completed_at = '2026-03-21T18:00:00.000Z';
    }
  }
  // Instant NDA post-close: keep open ops tasks for entity OS demo.
  for (const t of tasks) {
    if (t.deal_id === 'DE-LAU-01' && t.process_stage !== 'Post-Close') {
      t.status = 'Completed';
      t.completed_at = '2025-06-01T12:00:00.000Z';
    }
  }
  return tasks;
}

/** Patch LD-005 to link seeded deal. */
export function applyLeadDealLinks(leads: Lead[]): Lead[] {
  return leads.map((l) => {
    if (l.lead_id === 'LD-005') {
      return {
        ...l,
        deal_id: 'DE-001',
        outcome: 'Advanced to DD',
      };
    }
    return l;
  });
}
