'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { stopImpersonationAction } from '@/app/(app)/impersonation/actions';
import { APP_ROLE_LABELS, type AppRole } from '@/lib/types/roles';
import { Button } from '@/components/ui/button';

type Props = {
  role: AppRole;
};

export function ImpersonationBanner({ role }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function exit() {
    setError(null);
    startTransition(async () => {
      const result = await stopImpersonationAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-[#9f957c]/40 bg-[#3a414f] px-4 py-2.5 text-sm text-white md:px-6"
    >
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium tracking-tight">
          Viewing as:{' '}
          <span className="text-[#d7d3c3]">{APP_ROLE_LABELS[role]}</span>
        </p>
        <p className="text-xs font-normal text-amber-200/90">
          Break-glass: capital wires, IC decisions, and capital DocuSign are
          blocked until you exit.
        </p>
        {error ? (
          <p className="text-xs text-red-200" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={exit}
        className="h-8 shrink-0 border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
      >
        {pending ? 'Exiting…' : 'Exit Impersonation'}
      </Button>
    </div>
  );
}
