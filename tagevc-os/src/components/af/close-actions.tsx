'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  setPeriodLockAction,
  snapshotPeriodAction,
} from '@/app/(app)/shared-services/af/accounting/close/actions';
import type { EntityCode } from '@/lib/af';

export function CloseActions({
  entityCode,
  period,
  readyForHardLock,
}: {
  entityCode: EntityCode | 'CONSOL';
  period: string;
  readyForHardLock: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await snapshotPeriodAction({ entityCode, period });
            router.refresh();
          })
        }
      >
        Take snapshot
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await setPeriodLockAction({ entityCode, mode: 'soft', period });
            router.refresh();
          })
        }
      >
        Soft close
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={pending || !readyForHardLock}
        onClick={() =>
          start(async () => {
            await snapshotPeriodAction({ entityCode, period });
            await setPeriodLockAction({ entityCode, mode: 'hard', period });
            router.refresh();
          })
        }
      >
        Hard lock
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await setPeriodLockAction({ entityCode, mode: 'reopen', period });
            router.refresh();
          })
        }
      >
        Reopen
      </Button>
    </div>
  );
}
