import { randomUUID } from 'crypto';
import { logActivity } from '@/lib/data/activity';
import {
  buildInitialMaTasks,
  INITIAL_MA_TARGETS,
} from '@/lib/data/ma-seed';
import {
  fetchAllMaTargets,
  fetchAllMaTasks,
  syncMaTargetsAndTasks,
} from '@/lib/data/normalized/ma-repo';
import {
  preferNormalizedTables,
  queueNormalizedSync,
} from '@/lib/data/normalized/sync';
import {
  isStoreHydrated,
  loadStoreSnapshot,
  markStoreHydrated,
  queueStorePersist,
  saveStoreSnapshot,
} from '@/lib/data/persist';
import { createHandoffPack } from '@/lib/deal-flow/handoff';
import { spawnMaTasksForStage } from '@/lib/deal-flow/ma/spawn-tasks';
import type {
  HandoffPack,
  MaStage,
  MaTarget,
  MaTask,
  Priority,
  TaskStatus,
} from '@/lib/types';

type MaStore = {
  targets: MaTarget[];
  tasks: MaTask[];
  handoffs: HandoffPack[];
};

declare global {
  var __tageMaStore: MaStore | undefined;
}

function createStore(): MaStore {
  return {
    targets: structuredClone(INITIAL_MA_TARGETS),
    tasks: buildInitialMaTasks(),
    handoffs: [],
  };
}

export function getMaStore(): MaStore {
  if (!globalThis.__tageMaStore) {
    globalThis.__tageMaStore = createStore();
  }
  return globalThis.__tageMaStore;
}

function touchMa() {
  queueStorePersist('ma', () => structuredClone(getMaStore()));
  queueNormalizedSync('os_ma', async () => {
    const store = getMaStore();
    await syncMaTargetsAndTasks(store.targets, store.tasks);
  });
}

export async function hydrateMaStore() {
  if (isStoreHydrated('ma')) return;
  const snap = await loadStoreSnapshot<MaStore>('ma');
  if (snap?.payload?.targets) {
    globalThis.__tageMaStore = snap.payload;
  } else {
    const store = getMaStore();
    await saveStoreSnapshot('ma', store);
  }

  const store = getMaStore();
  const [sqlTargets, sqlTasks] = await Promise.all([
    fetchAllMaTargets(),
    fetchAllMaTasks(),
  ]);
  if (sqlTargets && (sqlTargets.length > 0 || preferNormalizedTables())) {
    if (sqlTargets.length > 0) store.targets = sqlTargets;
    if (sqlTasks && sqlTasks.length > 0) store.tasks = sqlTasks;
  } else if (sqlTargets !== null && store.targets.length > 0) {
    await syncMaTargetsAndTasks(store.targets, store.tasks);
  }

  markStoreHydrated('ma');
}

export function resetMaStore() {
  globalThis.__tageMaStore = createStore();
  touchMa();
}

function nextMaId(targets: MaTarget[]): string {
  const max = targets.reduce((m, t) => {
    const n = Number(t.ma_id.replace(/\D/g, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `MA-${String(max + 1).padStart(3, '0')}`;
}

export type CreateMaTargetInput = {
  company_name: string;
  website?: string;
  sector?: string;
  deal_type?: MaTarget['deal_type'];
  source?: string;
  owner?: string;
  priority?: Priority;
  enterprise_value_m?: number;
  revenue_m?: number;
  ebitda_m?: number;
  notes?: string;
};

export function createMaTarget(input: CreateMaTargetInput): MaTarget {
  const store = getMaStore();
  const now = new Date().toISOString();
  const target: MaTarget = {
    id: randomUUID(),
    ma_id: nextMaId(store.targets),
    company_name: input.company_name.trim(),
    website: input.website?.trim() || null,
    sector: input.sector?.trim() || null,
    deal_type: input.deal_type ?? 'Platform acquisition',
    source: input.source?.trim() || null,
    stage: 'Sourced',
    priority: input.priority ?? 'Medium',
    owner: input.owner?.trim() || 'Associate',
    enterprise_value_m: input.enterprise_value_m ?? null,
    revenue_m: input.revenue_m ?? null,
    ebitda_m: input.ebitda_m ?? null,
    next_action: 'Log target + strategic fit',
    next_action_date: null,
    exclusivity_end: null,
    strategic_fit: 'Unknown',
    notes: input.notes?.trim() || null,
    outcome: null,
    entity_id: null,
    handoff_id: null,
    created_at: now,
    updated_at: now,
    archived_at: null,
  };
  store.targets.push(target);
  const spawned = spawnMaTasksForStage(target, store.tasks, 'Sourced');
  store.tasks.push(...spawned);
  touchMa();
  void logActivity({
    module: 'ma',
    action: 'target_created',
    title: `M&A target created: ${target.company_name}`,
    ref_type: 'ma',
    ref_id: target.ma_id,
  });
  return target;
}

export function updateMaStage(
  maId: string,
  stage: MaStage,
): { target: MaTarget; spawned: MaTask[] } {
  const store = getMaStore();
  const target = store.targets.find((t) => t.ma_id === maId);
  if (!target) throw new Error(`M&A target ${maId} not found`);
  const now = new Date().toISOString();
  target.stage = stage;
  target.updated_at = now;

  if (stage === 'Integration') {
    target.outcome = 'Acquired';
    target.next_action = 'Day-1 / Day-100 integration plan';
  }

  const spawned = spawnMaTasksForStage(target, store.tasks, stage);
  store.tasks.push(...spawned);

  if (stage === 'Integration') {
    ensureMaHandoff(target);
  }

  touchMa();
  void logActivity({
    module: 'ma',
    action: 'ma_stage',
    title: `${target.company_name} → ${stage}`,
    ref_type: 'ma',
    ref_id: target.ma_id,
  });
  return { target, spawned };
}

function ensureMaHandoff(target: MaTarget): HandoffPack {
  const store = getMaStore();
  if (target.handoff_id) {
    const existing = store.handoffs.find((h) => h.handoff_id === target.handoff_id);
    if (existing) return existing;
  }
  const pack = createHandoffPack({
    track: 'M&A Buy',
    source_id: target.ma_id,
    company_name: target.company_name,
    thesis: target.notes,
    existing: store.handoffs,
  });
  store.handoffs.push(pack);
  target.handoff_id = pack.handoff_id;
  target.updated_at = new Date().toISOString();
  touchMa();
  return pack;
}

export function updateMaTaskStatus(
  taskId: string,
  status: TaskStatus,
): MaTask {
  const store = getMaStore();
  const task = store.tasks.find((t) => t.task_id === taskId);
  if (!task) throw new Error(`M&A task ${taskId} not found`);
  const now = new Date().toISOString();
  task.status = status;
  task.updated_at = now;
  task.completed_at = status === 'Completed' ? now : null;
  touchMa();
  return task;
}

export function listActiveMaTargets(): MaTarget[] {
  return getMaStore()
    .targets.filter((t) => !t.archived_at)
    .sort((a, b) => a.company_name.localeCompare(b.company_name));
}

export function getMaTarget(maId: string): MaTarget | null {
  return getMaStore().targets.find((t) => t.ma_id === maId) ?? null;
}

export function listTasksForMa(maId: string): MaTask[] {
  return getMaStore()
    .tasks.filter((t) => t.ma_id === maId)
    .sort((a, b) => a.task_id.localeCompare(b.task_id));
}

export function listMaHandoffs(): HandoffPack[] {
  return getMaStore().handoffs.slice();
}
