'use client';

import { useTransition } from 'react';
import { actionCompleteSetupStep } from '@/app/(app)/shared-services/af/actions';
import type { EntityCode } from '@/lib/af';

export function CompleteStepButton({
  entityCode,
  stepId,
}: {
  entityCode: EntityCode | 'ORG';
  stepId: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await actionCompleteSetupStep(entityCode, stepId);
        })
      }
      className="inline-flex h-8 items-center rounded-md border border-border bg-white px-2.5 text-xs font-medium hover:bg-muted/40 disabled:opacity-60"
    >
      {pending ? '…' : 'Mark done'}
    </button>
  );
}
