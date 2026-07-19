import { MA_STAGES, type MaStage } from '@/lib/types';
import {
  nextStageIn,
  previousStageIn,
} from '@/lib/deal-flow/shared/spawn-once';

export function nextMaStage(current: MaStage): MaStage | null {
  return nextStageIn(MA_STAGES, current);
}

export function previousMaStage(current: MaStage): MaStage | null {
  return previousStageIn(MA_STAGES, current);
}

/** Closing complete → Integration; outcome Acquired triggers portfolio handoff. */
export function isMaCloseStage(stage: MaStage): boolean {
  return stage === 'Closing' || stage === 'Integration';
}
