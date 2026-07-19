import { randomUUID } from 'crypto';
import type { Lead, LeadTask } from '@/lib/types';
import { templatesForStage } from '@/lib/deal-flow/process-library';

/**
 * Spawn missing Lead Process Library tasks for a stage.
 * Acceptance: stage change spawns missing template tasks once (by lib_id).
 */
export function spawnTasksForStage(
  lead: Lead,
  existingTasks: LeadTask[],
  stage = lead.stage,
): LeadTask[] {
  const templates = templatesForStage(stage);
  const already = new Set(
    existingTasks
      .filter((t) => t.lead_id === lead.lead_id && t.lib_id)
      .map((t) => t.lib_id),
  );

  const now = new Date().toISOString();
  const maxNum = existingTasks.reduce((max, t) => {
    const n = Number(t.task_id.replace(/\D/g, ''));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);

  const spawned: LeadTask[] = [];
  let seq = maxNum;
  for (const tpl of templates) {
    if (already.has(tpl.lib_id)) continue;
    seq += 1;
    spawned.push({
      id: randomUUID(),
      task_id: `LT-${String(seq).padStart(3, '0')}`,
      lead_id: lead.lead_id,
      company_name: lead.company_name,
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
    });
  }
  return spawned;
}
