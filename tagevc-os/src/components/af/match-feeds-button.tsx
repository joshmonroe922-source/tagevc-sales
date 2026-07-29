'use client';

import { useState, useTransition } from 'react';
import {
  actionMatchFeeds,
  actionSyncAllLiveFeeds,
} from '@/app/(app)/shared-services/af/actions';

export function MatchFeedsButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await actionSyncAllLiveFeeds();
            setMsg(result.message);
          })
        }
        className="inline-flex h-9 items-center rounded-md bg-[#3a414f] px-3 text-sm font-medium text-white hover:bg-[#2f3540] disabled:opacity-60"
      >
        {pending ? 'Syncing…' : 'Sync live Plaid'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await actionMatchFeeds();
            setMsg('Auto-match complete');
          })
        }
        className="inline-flex h-9 items-center rounded-md border border-border bg-white px-3 text-sm font-medium hover:bg-muted/40 disabled:opacity-60"
      >
        Auto-match feeds
      </button>
      {msg ? (
        <span className="text-xs text-muted-foreground">{msg}</span>
      ) : null}
    </div>
  );
}
