import { randomUUID } from 'crypto';
import { logActivity } from '@/lib/data/activity';
import {
  isStoreHydrated,
  loadStoreSnapshot,
  markStoreHydrated,
  queueStorePersist,
  saveStoreSnapshot,
} from '@/lib/data/persist';
import {
  buildInitialReTasks,
  INITIAL_RE_DEALS,
} from '@/lib/data/re-seed';
import {
  fetchAllHandoffs,
  filterHandoffsByTrack,
  syncHandoffs,
} from '@/lib/data/normalized/handoffs-repo';
import {
  fetchAllReDeals,
  fetchAllReTasks,
  syncReDealsAndTasks,
} from '@/lib/data/normalized/re-repo';
import {
  queueNormalizedSync,
  shouldUseNormalizedRows,
} from '@/lib/data/normalized/sync';
import { createHandoffPack } from '@/lib/deal-flow/handoff';
import { spawnReTasksForStage } from '@/lib/deal-flow/re/spawn-tasks';
import type {
  HandoffPack,
  Priority,
  ReDeal,
  ReRoute,
  ReStage,
  ReTask,
  TaskStatus,
} from '@/lib/types';

type ReStore = {
  deals: ReDeal[];
  tasks: ReTask[];
  handoffs: HandoffPack[];
};

declare global {
  var __tageReStore: ReStore | undefined;
}

function createStore(): ReStore {
  return {
    deals: structuredClone(INITIAL_RE_DEALS),
    tasks: buildInitialReTasks(),
    handoffs: [],
  };
}

export function getReStore(): ReStore {
  if (!globalThis.__tageReStore) {
    globalThis.__tageReStore = createStore();
  }
  return globalThis.__tageReStore;
}

function touchRe() {
  queueStorePersist('re', () => structuredClone(getReStore()));
  queueNormalizedSync('os_re', async () => {
    const store = getReStore();
    await syncReDealsAndTasks(store.deals, store.tasks);
  });
  queueNormalizedSync('os_handoffs_re', async () => {
    await syncHandoffs(getReStore().handoffs);
  });
}

export async function hydrateReStore() {
  if (isStoreHydrated('re')) return;
  const snap = await loadStoreSnapshot<ReStore>('re');
  if (snap?.payload?.deals) {
    globalThis.__tageReStore = snap.payload;
  } else {
    const store = getReStore();
    await saveStoreSnapshot('re', store);
  }

  const store = getReStore();
  const [sqlDeals, sqlTasks, sqlHandoffs] = await Promise.all([
    fetchAllReDeals(),
    fetchAllReTasks(),
    fetchAllHandoffs(),
  ]);
  if (shouldUseNormalizedRows(sqlDeals)) {
    if (sqlDeals.length > 0) store.deals = sqlDeals;
    if (sqlTasks && sqlTasks.length > 0) store.tasks = sqlTasks;
  } else if (sqlDeals !== null && store.deals.length > 0) {
    await syncReDealsAndTasks(store.deals, store.tasks);
  }

  const reHandoffs = sqlHandoffs
    ? filterHandoffsByTrack(sqlHandoffs, 'RE Buy')
    : null;
  if (shouldUseNormalizedRows(reHandoffs)) {
    if (reHandoffs.length > 0) store.handoffs = reHandoffs;
  } else if (reHandoffs !== null && store.handoffs.length > 0) {
    await syncHandoffs(store.handoffs);
  }

  markStoreHydrated('re');
}

export function resetReStore() {
  globalThis.__tageReStore = createStore();
  touchRe();
}

function nextReId(deals: ReDeal[]): string {
  const max = deals.reduce((m, d) => {
    const n = Number(d.re_id.replace(/\D/g, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `RE-${String(max + 1).padStart(3, '0')}`;
}

export type CreateReDealInput = {
  asset_name: string;
  route: ReRoute;
  asset_type?: string;
  market?: string;
  source?: string;
  sourcer?: string;
  priority?: Priority;
  ask_k?: number;
  notes?: string;
};

export function createReDeal(input: CreateReDealInput): ReDeal {
  const store = getReStore();
  const now = new Date().toISOString();
  const deal: ReDeal = {
    id: randomUUID(),
    re_id: nextReId(store.deals),
    asset_name: input.asset_name.trim(),
    route: input.route,
    asset_type: input.asset_type?.trim() || null,
    market: input.market?.trim() || null,
    source: input.source?.trim() || null,
    stage: 'Sourced',
    priority: input.priority ?? 'Medium',
    sourcer:
      input.sourcer?.trim() ||
      (input.route === 'Residential'
        ? 'RE Sourcer — Resi'
        : 'RE Sourcer — CRE'),
    ask_k: input.ask_k ?? null,
    offer_k: null,
    noi_k: null,
    cap_yield_signal: null,
    next_action: 'Log asset + thesis fit',
    next_action_date: null,
    notes: input.notes?.trim() || null,
    outcome: null,
    entity_id: null,
    handoff_id: null,
    created_at: now,
    updated_at: now,
    archived_at: null,
  };
  store.deals.push(deal);
  const spawned = spawnReTasksForStage(deal, store.tasks, 'Sourced');
  store.tasks.push(...spawned);
  touchRe();
  void logActivity({
    module: 're',
    action: 'deal_created',
    title: `RE deal created: ${deal.asset_name}`,
    ref_type: 're',
    ref_id: deal.re_id,
  });
  return deal;
}

export function updateReStage(
  reId: string,
  stage: ReStage,
): { deal: ReDeal; spawned: ReTask[] } {
  const store = getReStore();
  const deal = store.deals.find((d) => d.re_id === reId);
  if (!deal) throw new Error(`RE deal ${reId} not found`);
  const now = new Date().toISOString();
  deal.stage = stage;
  deal.updated_at = now;

  if (stage === 'Onboard') {
    deal.outcome = 'Purchased';
    deal.next_action = 'Add to RE Portfolio; PM kickoff';
  }

  const spawned = spawnReTasksForStage(deal, store.tasks, stage);
  store.tasks.push(...spawned);

  if (stage === 'Onboard') {
    ensureReHandoff(deal);
  }

  touchRe();
  void logActivity({
    module: 're',
    action: 're_stage',
    title: `${deal.asset_name} → ${stage}`,
    ref_type: 're',
    ref_id: deal.re_id,
  });
  return { deal, spawned };
}

function ensureReHandoff(deal: ReDeal): HandoffPack {
  const store = getReStore();
  if (deal.handoff_id) {
    const existing = store.handoffs.find((h) => h.handoff_id === deal.handoff_id);
    if (existing) return existing;
  }
  const pack = createHandoffPack({
    track: 'RE Buy',
    source_id: deal.re_id,
    company_name: deal.asset_name,
    thesis: deal.notes,
    existing: store.handoffs,
  });
  store.handoffs.push(pack);
  deal.handoff_id = pack.handoff_id;
  deal.updated_at = new Date().toISOString();
  touchRe();
  return pack;
}

export function updateReTaskStatus(
  taskId: string,
  status: TaskStatus,
): ReTask {
  const store = getReStore();
  const task = store.tasks.find((t) => t.task_id === taskId);
  if (!task) throw new Error(`RE task ${taskId} not found`);
  const now = new Date().toISOString();
  task.status = status;
  task.updated_at = now;
  task.completed_at = status === 'Completed' ? now : null;
  touchRe();
  return task;
}

export function listActiveReDeals(): ReDeal[] {
  return getReStore()
    .deals.filter((d) => !d.archived_at)
    .sort((a, b) => a.asset_name.localeCompare(b.asset_name));
}

export function getReDeal(reId: string): ReDeal | null {
  return getReStore().deals.find((d) => d.re_id === reId) ?? null;
}

export function listTasksForRe(reId: string): ReTask[] {
  return getReStore()
    .tasks.filter((t) => t.re_id === reId)
    .sort((a, b) => a.task_id.localeCompare(b.task_id));
}

export function listReHandoffs(): HandoffPack[] {
  return getReStore().handoffs.slice();
}
