'use client';

import { useState, useTransition } from 'react';
import { actionPollApInbound } from '@/app/(app)/shared-services/af/ap-poll-actions';

export function ApInboundPollButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={pending}
        className="rounded-md border border-border px-3 py-2 text-xs font-medium disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const r = await actionPollApInbound();
            setMsg(
              r.ok
                ? `Polled OK · processed ${r.processed ?? 0}`
                : r.error || 'poll failed',
            );
          })
        }
      >
        {pending ? 'Polling…' : 'Poll AP/W-9 mailbox now'}
      </button>
      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
    </div>
  );
}
