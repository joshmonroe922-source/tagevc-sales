import type { MaTarget, MaTask } from '@/lib/types';
import { spawnMaTasksForStage } from '@/lib/deal-flow/ma/spawn-tasks';

const now = '2026-03-15T12:00:00.000Z';

/** M&A Pipeline Active seeds (Excel). */
export const INITIAL_MA_TARGETS: MaTarget[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
    ma_id: 'MA-001',
    company_name: 'Midwest Ops Co',
    website: 'midwestops.example',
    sector: 'Business services',
    deal_type: 'Platform acquisition',
    source: 'Broker',
    stage: 'LOI / Exclusivity',
    priority: 'Critical',
    owner: 'Partner',
    enterprise_value_m: 18,
    revenue_m: 12,
    ebitda_m: 2.4,
    next_action: 'Quality of earnings kickoff',
    next_action_date: '2026-03-26',
    exclusivity_end: '2026-05-01',
    strategic_fit: 'Strong',
    notes: 'Owner retirement; add-on pipeline exists',
    outcome: null,
    entity_id: null,
    handoff_id: null,
    created_at: '2026-03-01T12:00:00.000Z',
    updated_at: now,
    archived_at: null,
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02',
    ma_id: 'MA-002',
    company_name: 'Regional Add-On LLC',
    website: 'regionaladdon.example',
    sector: 'Business services',
    deal_type: 'Add-on / roll-up',
    source: 'Proprietary',
    stage: 'Management Meeting',
    priority: 'High',
    owner: 'Associate',
    enterprise_value_m: 4.5,
    revenue_m: 3.2,
    ebitda_m: 0.7,
    next_action: 'Site visit + customer refs',
    next_action_date: '2026-03-28',
    exclusivity_end: null,
    strategic_fit: 'Medium',
    notes: 'Bolt onto Midwest Ops platform thesis',
    outcome: null,
    entity_id: null,
    handoff_id: null,
    created_at: '2026-03-12T12:00:00.000Z',
    updated_at: now,
    archived_at: null,
  },
];

export function buildInitialMaTasks(): MaTask[] {
  let tasks: MaTask[] = [];
  for (const target of INITIAL_MA_TARGETS) {
    const stages =
      target.ma_id === 'MA-001'
        ? ([
            'Sourced',
            'CIM Review',
            'Management Meeting',
            'IOI / Indication',
            'LOI / Exclusivity',
          ] as const)
        : ([
            'Sourced',
            'CIM Review',
            'Management Meeting',
          ] as const);
    for (const stage of stages) {
      const spawned = spawnMaTasksForStage(target, tasks, stage);
      tasks = [...tasks, ...spawned];
    }
  }
  return tasks;
}
