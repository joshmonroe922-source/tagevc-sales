'use client';

import { useState, useTransition } from 'react';
import {
  actionGenerateAccountBrief,
  actionRunSiteResearch,
} from '@/app/(app)/shared-services/crm/actions';

export function AccountAgentPanel({ accountId }: { accountId: string }) {
  const [pending, start] = useTransition();
  const [brief, setBrief] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <section className="space-y-3 rounded-md border border-border p-4">
      <h2 className="text-sm font-semibold">Agents (C9–C10)</h2>
      <p className="text-xs text-muted-foreground">
        Site research is public-meta only. Brief is graph-derived (no paid LLM).
        Paid enrich stays fail-closed until LIVE keys.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          onClick={() =>
            start(async () => {
              setMsg(null);
              const r = await actionGenerateAccountBrief(accountId);
              if (r.ok) setBrief(r.markdown);
              else setMsg(r.error);
            })
          }
        >
          Generate account brief
        </button>
        <button
          type="button"
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          onClick={() =>
            start(async () => {
              setMsg(null);
              const r = await actionRunSiteResearch(accountId);
              setMsg(
                r.ok
                  ? `Site research: ${r.title || 'no title'} · suggestions ${r.suggestions}`
                  : r.error,
              );
            })
          }
        >
          Run site research
        </button>
      </div>
      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
      {brief ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">
          {brief}
        </pre>
      ) : null}
    </section>
  );
}
