'use client';

import { useState, useTransition } from 'react';
import { actionDecideSuggestedUpdate } from '@/app/(app)/shared-services/crm/actions';

type Row = {
  id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  suggested_value: string | null;
  confidence: number | null;
  status: string;
  rationale: string | null;
  created_at: string;
};

export function SuggestionsInbox({ rows }: { rows: Row[] }) {
  const [pending, start] = useTransition();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const visible = rows.filter((r) => !gone.has(r.id));

  if (!visible.length) {
    return (
      <p className="text-sm text-muted-foreground">No pending suggestions.</p>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border text-sm">
      {visible.map((r) => (
        <li key={r.id} className="space-y-2 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="font-medium">
                {r.entity_type}.{r.field_name}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                conf {r.confidence ?? '—'} · {r.entity_id.slice(0, 8)}…
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                onClick={() =>
                  start(async () => {
                    setErr(null);
                    const res = await actionDecideSuggestedUpdate(
                      r.id,
                      'accepted',
                    );
                    if (res.ok) setGone((s) => new Set(s).add(r.id));
                    else setErr(res.error);
                  })
                }
              >
                Accept
              </button>
              <button
                type="button"
                disabled={pending}
                className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                onClick={() =>
                  start(async () => {
                    setErr(null);
                    const res = await actionDecideSuggestedUpdate(
                      r.id,
                      'rejected',
                    );
                    if (res.ok) setGone((s) => new Set(s).add(r.id));
                    else setErr(res.error);
                  })
                }
              >
                Reject
              </button>
            </div>
          </div>
          <p className="text-xs">{r.suggested_value || '—'}</p>
          {r.rationale ? (
            <p className="text-xs text-muted-foreground">{r.rationale}</p>
          ) : null}
        </li>
      ))}
      {err ? <li className="px-4 py-2 text-xs text-red-600">{err}</li> : null}
    </ul>
  );
}
