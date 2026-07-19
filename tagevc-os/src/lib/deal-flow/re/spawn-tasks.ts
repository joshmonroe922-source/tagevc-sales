import type { ReDeal, ReTask } from '@/lib/types';
import { reTemplatesForStage } from '@/lib/deal-flow/re/process-library';
import { spawnOnceFromTemplates } from '@/lib/deal-flow/shared/spawn-once';

export function spawnReTasksForStage(
  deal: ReDeal,
  existingTasks: ReTask[],
  stage = deal.stage,
): ReTask[] {
  const templates = reTemplatesForStage(stage, deal.route);
  const already = new Set(
    existingTasks
      .filter((t) => t.re_id === deal.re_id && t.lib_id)
      .map((t) => t.lib_id),
  );

  return spawnOnceFromTemplates({
    templates,
    existingLibIds: already,
    existingTaskIds: existingTasks.map((t) => t.task_id),
    idPrefix: 'RT',
    enrich: (base) => ({
      ...base,
      re_id: deal.re_id,
      asset_name: deal.asset_name,
      route: deal.route,
    }),
  });
}
