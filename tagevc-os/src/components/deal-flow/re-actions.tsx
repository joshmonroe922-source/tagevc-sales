'use client';

import {
  changeReStageAction,
  setReTaskStatusAction,
} from '@/app/(app)/deal-flow/re/actions';
import {
  TrackStageSelect,
  TrackTaskStatusSelect,
} from '@/components/deal-flow/track-controls';
import type { ReStage, TaskStatus } from '@/lib/types';
import { RE_STAGES } from '@/lib/types';

export function ReStageSelect({
  reId,
  stage,
}: {
  reId: string;
  stage: ReStage;
}) {
  return (
    <TrackStageSelect
      value={stage}
      stages={RE_STAGES}
      onChange={(next) => changeReStageAction(reId, next)}
    />
  );
}

export function ReTaskStatusSelect({
  taskId,
  reId,
  status,
}: {
  taskId: string;
  reId: string;
  status: TaskStatus;
}) {
  return (
    <TrackTaskStatusSelect
      taskId={taskId}
      status={status}
      onChange={(id, next) => setReTaskStatusAction(id, next, reId)}
    />
  );
}
