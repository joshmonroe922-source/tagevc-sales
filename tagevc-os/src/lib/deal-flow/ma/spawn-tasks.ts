import type { MaTarget, MaTask } from '@/lib/types';
import { maTemplatesForStage } from '@/lib/deal-flow/ma/process-library';
import { spawnOnceFromTemplates } from '@/lib/deal-flow/shared/spawn-once';

export function spawnMaTasksForStage(
  target: MaTarget,
  existingTasks: MaTask[],
  stage = target.stage,
): MaTask[] {
  const templates = maTemplatesForStage(stage);
  const already = new Set(
    existingTasks
      .filter((t) => t.ma_id === target.ma_id && t.lib_id)
      .map((t) => t.lib_id),
  );

  return spawnOnceFromTemplates({
    templates,
    existingLibIds: already,
    existingTaskIds: existingTasks.map((t) => t.task_id),
    idPrefix: 'MT',
    enrich: (base) => ({
      ...base,
      ma_id: target.ma_id,
      company_name: target.company_name,
    }),
  });
}
