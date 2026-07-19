import { RE_STAGES, type ReStage } from '@/lib/types';
import {
  nextStageIn,
  previousStageIn,
} from '@/lib/deal-flow/shared/spawn-once';

export function nextReStage(current: ReStage): ReStage | null {
  return nextStageIn(RE_STAGES, current);
}

export function previousReStage(current: ReStage): ReStage | null {
  return previousStageIn(RE_STAGES, current);
}

export function isReOnboardStage(stage: ReStage): boolean {
  return stage === 'Onboard';
}
