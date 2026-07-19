'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  changeDealExecStageAction,
  setDealTaskStatusAction,
  submitIcAction,
} from '@/app/(app)/deal-flow/vc/actions';
import { TrackStageSelect, TrackTaskStatusSelect } from '@/components/deal-flow/track-controls';
import { Button } from '@/components/ui/button';
import { EXEC_STAGES, type ExecStage, type TaskStatus } from '@/lib/types';

export function DealExecStageSelect({
  dealId,
  stage,
}: {
  dealId: string;
  stage: ExecStage;
}) {
  return (
    <TrackStageSelect
      value={stage}
      stages={EXEC_STAGES}
      onChange={(next) => changeDealExecStageAction(dealId, next)}
    />
  );
}

export function DealTaskStatusSelect({
  taskId,
  dealId,
  status,
}: {
  taskId: string;
  dealId: string;
  status: TaskStatus;
}) {
  return (
    <TrackTaskStatusSelect
      taskId={taskId}
      status={status}
      onChange={(id, next) => setDealTaskStatusAction(id, next, dealId)}
    />
  );
}

export function SubmitIcButton({
  dealId,
  disabled,
}: {
  dealId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled || pending}
      onClick={() => {
        startTransition(async () => {
          const res = await submitIcAction(dealId);
          if (!res.ok) alert(res.error);
          router.refresh();
        });
      }}
    >
      {pending ? 'Submitting…' : 'Submit to IC'}
    </Button>
  );
}
