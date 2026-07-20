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
  /** Stages that cannot be selected (e.g. break-glass while impersonating). */
  disabledStages?: readonly string[];
  disabledHint?: string;
};

export function TrackStageSelect({
  value,
  stages,
  onChange,
  disabledStages = [],
  disabledHint,
}: StageProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-1">
      <select
        className="h-8 max-w-[12rem] rounded-lg border border-input bg-background px-2 text-sm"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          if (disabledStages.includes(next)) {
            alert(
              disabledHint ??
                'This stage is blocked while impersonating. Exit impersonation first.',
            );
            e.target.value = value;
            return;
          }
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
          <option key={s} value={s} disabled={disabledStages.includes(s)}>
            {s}
            {disabledStages.includes(s) ? ' (blocked)' : ''}
          </option>
        ))}
      </select>
      {disabledStages.length > 0 && disabledHint ? (
        <p className="max-w-xs text-[11px] text-amber-800">{disabledHint}</p>
      ) : null}
    </div>
  );
}
