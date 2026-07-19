'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  convertLeadToDealAction,
  setTaskStatusAction,
} from '@/app/(app)/deal-flow/vc/actions';
import { Button } from '@/components/ui/button';
import { TASK_STATUSES, type TaskStatus } from '@/lib/types';

export function TaskStatusSelect({
  taskId,
  leadId,
  status,
}: {
  taskId: string;
  leadId: string;
  status: TaskStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
      value={status}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        startTransition(async () => {
          await setTaskStatusAction(taskId, next, leadId);
          router.refresh();
        });
      }}
    >
      {TASK_STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

export function ConvertToDealButton({
  leadId,
  disabled,
  existingDealId,
}: {
  leadId: string;
  disabled?: boolean;
  existingDealId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (existingDealId) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => router.push(`/deal-flow/vc/deals/${existingDealId}`)}
      >
        Open {existingDealId}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      disabled={disabled || pending}
      onClick={() => {
        startTransition(async () => {
          const res = await convertLeadToDealAction(leadId);
          if (res.ok && res.dealId) {
            router.push(`/deal-flow/vc/deals/${res.dealId}`);
          } else if (!res.ok) {
            alert(res.error);
          }
        });
      }}
    >
      {pending ? 'Opening…' : 'Open Deal Active'}
    </Button>
  );
}
