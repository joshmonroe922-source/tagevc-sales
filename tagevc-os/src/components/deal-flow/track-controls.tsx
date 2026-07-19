'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { TASK_STATUSES, type TaskStatus } from '@/lib/types';

type Props = {
  taskId: string;
  status: TaskStatus;
  onChange: (taskId: string, status: string) => Promise<unknown>;
};

export function TrackTaskStatusSelect({ taskId, status, onChange }: Props) {
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
          await onChange(taskId, next);
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

type StageProps = {
  value: string;
  stages: readonly string[];
  onChange: (stage: string) => Promise<unknown>;
};

export function TrackStageSelect({ value, stages, onChange }: StageProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      className="h-8 max-w-[12rem] rounded-lg border border-input bg-background px-2 text-sm"
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        startTransition(async () => {
          const res = (await onChange(next)) as
            | { ok?: boolean; error?: string }
            | undefined;
          if (res && res.ok === false && res.error) {
            alert(res.error);
          }
          router.refresh();
        });
      }}
    >
      {stages.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
