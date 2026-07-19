import { PIPELINE_STAGES, type PipelineStage } from '@/lib/types';

export function stageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

export function canAdvanceTo(
  current: PipelineStage,
  next: PipelineStage,
): boolean {
  const from = stageIndex(current);
  const to = stageIndex(next);
  if (from < 0 || to < 0) return false;
  // Allow move to any stage for ops flexibility (Excel allows rework).
  return true;
}

export function nextStage(current: PipelineStage): PipelineStage | null {
  const i = stageIndex(current);
  if (i < 0 || i >= PIPELINE_STAGES.length - 1) return null;
  return PIPELINE_STAGES[i + 1];
}

export function previousStage(current: PipelineStage): PipelineStage | null {
  const i = stageIndex(current);
  if (i <= 0) return null;
  return PIPELINE_STAGES[i - 1];
}

export function isReadyForDealConversion(stage: PipelineStage): boolean {
  return stage === 'Ready for DD';
}
