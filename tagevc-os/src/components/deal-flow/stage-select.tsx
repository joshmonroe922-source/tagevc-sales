'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { changeLeadStageAction } from '@/app/(app)/deal-flow/vc/actions';
import { PIPELINE_STAGES, type PipelineStage } from '@/lib/types';

export function StageSelect({
  leadId,
  stage,
}: {
  leadId: string;
  stage: PipelineStage;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      className="h-8 max-w-[11rem] rounded-lg border border-input bg-background px-2 text-sm"
      value={stage}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        startTransition(async () => {
          await changeLeadStageAction(leadId, next);
          router.refresh();
        });
      }}
    >
      {PIPELINE_STAGES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
