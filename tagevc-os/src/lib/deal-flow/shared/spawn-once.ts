import { randomUUID } from 'crypto';
import type { Priority, TaskStatus } from '@/lib/types';

export type SpawnTemplate = {
  lib_id: string;
  process_stage: string;
  title: string;
  default_priority: Priority;
  owner_role: string;
  what_good_looks_like: string;
};

export type SpawnedTaskBase = {
  id: string;
  task_id: string;
  process_stage: string;
  title: string;
  priority: Priority;
  status: TaskStatus;
  owner: string | null;
  due_date: string | null;
  notes: string | null;
  lib_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

/**
 * Generic spawn-once: create missing template tasks by lib_id.
 * Shared across VC lead/deal, M&A, and RE tracks.
 */
export function spawnOnceFromTemplates<T extends SpawnedTaskBase>(opts: {
  templates: SpawnTemplate[];
  existingLibIds: Set<string | null>;
  existingTaskIds: string[];
  idPrefix: string;
  enrich: (base: SpawnedTaskBase, tpl: SpawnTemplate) => T;
  now?: string;
}): T[] {
  const now = opts.now ?? new Date().toISOString();
  const maxNum = opts.existingTaskIds.reduce((max, id) => {
    const n = Number(id.replace(/\D/g, ''));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);

  const spawned: T[] = [];
  let seq = maxNum;
  for (const tpl of opts.templates) {
    if (opts.existingLibIds.has(tpl.lib_id)) continue;
    seq += 1;
    const base: SpawnedTaskBase = {
      id: randomUUID(),
      task_id: `${opts.idPrefix}-${String(seq).padStart(3, '0')}`,
      process_stage: tpl.process_stage,
      title: tpl.title,
      priority: tpl.default_priority,
      status: 'Not Started',
      owner: tpl.owner_role,
      due_date: null,
      notes: tpl.what_good_looks_like,
      lib_id: tpl.lib_id,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };
    spawned.push(opts.enrich(base, tpl));
  }
  return spawned;
}

export function nextStageIn<T extends string>(
  stages: readonly T[],
  current: T,
): T | null {
  const i = stages.indexOf(current);
  if (i < 0 || i >= stages.length - 1) return null;
  return stages[i + 1];
}

export function previousStageIn<T extends string>(
  stages: readonly T[],
  current: T,
): T | null {
  const i = stages.indexOf(current);
  if (i <= 0) return null;
  return stages[i - 1];
}
