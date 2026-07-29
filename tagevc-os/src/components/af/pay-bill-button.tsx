'use client';

import { useTransition } from 'react';
import { actionPayBill } from '@/app/(app)/shared-services/af/actions';

export function PayBillButton({ billId }: { billId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await actionPayBill(billId); })}
      className="inline-flex h-8 items-center rounded-md bg-[#3a414f] px-2.5 text-xs font-medium text-white hover:bg-[#2f3540] disabled:opacity-60"
    >
      {pending ? 'Paying…' : 'Pay'}
    </button>
  );
}
