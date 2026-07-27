'use client';

import {
  changeMaStageAction,
  setMaTaskStatusAction,
} from '@/app/(app)/deal-flow/ma/actions';
import {
  TrackStageSelect,
  TrackTaskStatusSelect,
} from '@/components/deal-flow/track-controls';
import { MA_STAGES, type MaStage, type TaskStatus } from '@/lib/types';

export function MaStageSelect({
  maId,
  stage,
}: {
  maId: string;
  stage: MaStage;
}) {
  return (
    <TrackStageSelect
      value={stage}
      stages={MA_STAGES}
      onChange={(next) => changeMaStageAction(maId, next)}
    />
  );
}

export function MaTaskStatusSelect({
  taskId,
  maId,
  status,
}: {
  taskId: string;
  maId: string;
  status: TaskStatus;
}) {
  return (
    <TrackTaskStatusSelect
      taskId={taskId}
      status={status}
      onChange={(id, next) => setMaTaskStatusAction(id, next, maId)}
    />
  );
}
