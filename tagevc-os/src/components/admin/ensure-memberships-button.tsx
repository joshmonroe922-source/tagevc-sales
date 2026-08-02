'use client';

import { useState, useTransition } from 'react';
import { actionEnsureSpineMemberships } from '@/app/(app)/admin/enrichment/actions';

export function EnsureMembershipsButton() {
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
            const r = await actionEnsureSpineMemberships();
            setMsg(
              r.ok
                ? `Memberships OK (${r.orgCount} orgs)`
                : r.error,
            );
          })
        }
      >
        {pending ? 'Ensuring…' : 'Ensure my spine org memberships'}
      </button>
      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
    </div>
  );
}
