import type { ReDeal, ReTask } from '@/lib/types';
import { spawnReTasksForStage } from '@/lib/deal-flow/re/spawn-tasks';

/** Soft-archived so empty-DB reseeds / demos do not resurrect on RE Active. */
const archivedDemo = '2026-07-26T17:00:00.000Z';

/**
 * RE Pipeline seeds (Excel). Sample assets stay for history but are
 * soft-archived so Deal Flow → Real Estate Active stays empty of sample noise.
 */
export const INITIAL_RE_DEALS: ReDeal[] = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01',
    re_id: 'RE-001',
    asset_name: '1842 Maple St, Indianapolis',
    route: 'Residential',
    asset_type: 'SFR value-add',
    market: 'Indianapolis, IN',
    source: 'Off-market / agent',
    stage: 'Underwriting',
    priority: 'High',
    sourcer: 'RE Sourcer — Resi',
    ask_k: 285,
    offer_k: 265,
    noi_k: 28.8,
    cap_yield_signal: 'ARV path',
    next_action: 'Finish rehab budget + comps',
    next_action_date: '2026-03-25',
    notes: '3bd/2ba; light value-add',
    outcome: null,
    entity_id: null,
    handoff_id: null,
    created_at: '2026-03-10T12:00:00.000Z',
    updated_at: archivedDemo,
    archived_at: archivedDemo,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02',
    re_id: 'RE-002',
    asset_name: 'Carmel Flex — 12k SF',
    route: 'Commercial',
    asset_type: 'Flex / industrial',
    market: 'Carmel, IN',
    source: 'Broker CIM',
    stage: 'LOI / PSA',
    priority: 'Critical',
    sourcer: 'RE Sourcer — CRE',
    ask_k: 2400,
    offer_k: 2250,
    noi_k: 168,
    cap_yield_signal: '7.5% cap on offer',
    next_action: 'Order Phase I + rent roll audit',
    next_action_date: '2026-03-26',
    notes: '90% occupied; 2 tenants roll in 14 mo',
    outcome: null,
    entity_id: null,
    handoff_id: null,
    created_at: '2026-03-05T12:00:00.000Z',
    updated_at: archivedDemo,
    archived_at: archivedDemo,
  },
];

export function buildInitialReTasks(): ReTask[] {
  let tasks: ReTask[] = [];
  for (const deal of INITIAL_RE_DEALS) {
    if (deal.archived_at) continue;
    const stages =
      deal.re_id === 'RE-002'
        ? ([
            'Sourced',
            'Screen',
            'Underwriting',
            'Offer',
            'LOI / PSA',
          ] as const)
        : (['Sourced', 'Screen', 'Underwriting'] as const);
    for (const stage of stages) {
      const spawned = spawnReTasksForStage(deal, tasks, stage);
      tasks = [...tasks, ...spawned];
    }
  }
  return tasks;
}
