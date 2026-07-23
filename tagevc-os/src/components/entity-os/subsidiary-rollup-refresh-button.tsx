'use client';

import { useTransition } from 'react';
import { refreshSubsidiaryRollupPhase53Action } from '@/app/(app)/entities/actions';
import { Button } from '@/components/ui/button';

export function SubsidiaryRollupRefreshButton({
  entityId = 'ENT-R619',
}: {
  entityId?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await refreshSubsidiaryRollupPhase53Action(entityId);
        });
      }}
    >
      {pending ? 'Refreshing…' : 'Refresh rollup'}
    </Button>
  );
}
