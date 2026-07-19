import { EXEC_STAGES, type ExecStage } from '@/lib/types';
import {
  nextStageIn,
  previousStageIn,
} from '@/lib/deal-flow/shared/spawn-once';

export function execStageIndex(stage: ExecStage): number {
  return EXEC_STAGES.indexOf(stage);
}

export function nextExecStage(current: ExecStage): ExecStage | null {
  return nextStageIn(EXEC_STAGES, current);
}

export function previousExecStage(current: ExecStage): ExecStage | null {
  return previousStageIn(EXEC_STAGES, current);
}

/** Advancing past IC Approved requires a recorded Approve decision. */
export function requiresIcApproval(from: ExecStage, to: ExecStage): boolean {
  return from === 'IC Approved' && to !== 'IC Approved';
}

export function isTerminalWired(stage: ExecStage): boolean {
  return stage === 'Wired / Closed' || stage === 'Post-Close';
}
