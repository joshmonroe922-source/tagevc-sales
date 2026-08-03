'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Job = {
  id: string;
  type: string;
  status: string;
  progress_pct: number | null;
  progress_message: string | null;
  account_id: string | null;
};

export function JobProgressToast() {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/spine/jobs?active=1', {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = (await res.json()) as { jobs?: Job[] };
        if (!cancelled) setJobs(json.jobs ?? []);
      } catch {
        /* soft */
      }
    };
    void tick();
    const id = window.setInterval(tick, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const active = jobs.filter(
    (j) => j.status === 'queued' || j.status === 'running',
  );
  if (!active.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[70] w-80 space-y-2">
      {active.slice(0, 3).map((j) => (
        <div
          key={j.id}
          className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-lg"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{j.type}</span>
            <span className="uppercase text-muted-foreground">{j.status}</span>
          </div>
          <div className="mt-1 text-muted-foreground">
            {j.progress_message ||
              (j.progress_pct != null ? `${j.progress_pct}%` : 'working…')}
          </div>
          {j.account_id ? (
            <Link
              href={`/shared-services/crm/accounts/${j.account_id}`}
              className="mt-1 inline-block underline underline-offset-2"
            >
              Open account
            </Link>
          ) : null}
        </div>
      ))}
    </div>
  );
}
