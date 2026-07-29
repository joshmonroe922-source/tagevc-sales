'use client';

import { useTransition } from 'react';
import { actionMatchFeeds } from '@/app/(app)/shared-services/af/actions';

export function MatchFeedsButton() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await actionMatchFeeds(); })}
      className="inline-flex h-9 items-center rounded-md border border-border bg-white px-3 text-sm font-medium hover:bg-muted/40 disabled:opacity-60"
    >
      {pending ? 'Matching…' : 'Auto-match feeds'}
    </button>
  );
}
