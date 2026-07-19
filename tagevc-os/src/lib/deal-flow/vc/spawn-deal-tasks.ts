import type { Deal, DealTask } from '@/lib/types';
import { dealTemplatesForStage } from '@/lib/deal-flow/vc/deal-process-library';
import { spawnOnceFromTemplates } from '@/lib/deal-flow/shared/spawn-once';

export function spawnDealTasksForStage(
  deal: Deal,
  existingTasks: DealTask[],
  stage = deal.exec_stage,
): DealTask[] {
  const templates = dealTemplatesForStage(stage);
  const already = new Set(
    existingTasks
      .filter((t) => t.deal_id === deal.deal_id && t.lib_id)
      .map((t) => t.lib_id),
  );

  return spawnOnceFromTemplates({
    templates,
    existingLibIds: already,
    existingTaskIds: existingTasks.map((t) => t.task_id),
    idPrefix: 'DT',
    enrich: (base) => ({
      ...base,
      deal_id: deal.deal_id,
      company_name: deal.company_name,
    }),
  });
}
