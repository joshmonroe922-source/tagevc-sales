'use client';

import { useTransition } from 'react';
import { actionPayInvoice } from '@/app/(app)/shared-services/af/actions';

export function PayInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await actionPayInvoice(invoiceId); })}
      className="inline-flex h-8 items-center rounded-md bg-[#3a414f] px-2.5 text-xs font-medium text-white hover:bg-[#2f3540] disabled:opacity-60"
    >
      {pending ? 'Posting…' : 'Mark paid'}
    </button>
  );
}
