'use client';

import { useTransition } from 'react';
import { actionRunIcFees } from '@/app/(app)/shared-services/af/actions';

export function IcFeeRunButton({ period }: { period: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await actionRunIcFees(period);
        })
      }
      className="rounded-md bg-[#3a414f] px-4 py-2 text-sm font-medium text-white hover:bg-[#535c63] disabled:opacity-50"
    >
      {pending ? 'Running…' : `Run ${period} mgmt fees`}
    </button>
  );
}
