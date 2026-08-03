'use client';

import { useState, useTransition } from 'react';

export function CopilotProbe() {
  const [pending, start] = useTransition();
  const [out, setOut] = useState<string>('');

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-xs"
          onClick={() =>
            start(async () => {
              const res = await fetch('/api/spine/copilot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tool: 'list_agents' }),
              });
              setOut(JSON.stringify(await res.json(), null, 2));
            })
          }
        >
          list_agents
        </button>
        <button
          type="button"
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-xs"
          onClick={() =>
            start(async () => {
              const res = await fetch('/api/spine/copilot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tool: 'search', q: 'tage' }),
              });
              setOut(JSON.stringify(await res.json(), null, 2));
            })
          }
        >
          search “tage”
        </button>
      </div>
      {out ? (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 text-[11px]">
          {out}
        </pre>
      ) : null}
    </div>
  );
}