'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        Something went wrong
      </p>
      <h1 className="font-heading text-2xl font-semibold text-[#3a414f]">
        We couldn&apos;t load this view
      </h1>
      <p className="text-sm text-muted-foreground">
        {error.message || 'An unexpected error occurred. Try again.'}
      </p>
      <Button onClick={reset} className="bg-[#3a414f] text-white hover:bg-[#535c63]">
        Try again
      </Button>
    </div>
  );
}
