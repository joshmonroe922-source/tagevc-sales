'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { exitEntityOsAction } from '@/app/(app)/entity-os/actions';
import { Button } from '@/components/ui/button';

type Props = {
  /** Full company name of the OS being worked in. */
  label: string;
};

/**
 * Shown while a firm-wide operator is scoped into a subsidiary OS, so the
 * narrower data set is never mistaken for a firm-wide view.
 */
export function EntityOsBanner({ label }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function exit() {
    setError(null);
    startTransition(async () => {
      const result = await exitEntityOsAction();
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
          Working in: <span className="text-[#d7d3c3]">{label}</span>
        </p>
        <p className="text-xs font-normal text-[#d7d3c3]/80">
          Data, nav, and scope are limited to this company. Exit to return to
          the firm-wide view.
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
        {pending ? 'Exiting…' : 'Exit to Tage VC'}
      </Button>
    </div>
  );
}
