'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

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
    const pollId = window.setInterval(tick, 15_000);

    // Realtime on enrichment_jobs when available (poll remains fallback).
    let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null =
      null;
    try {
      const sb = createClient();
      channel = sb
        .channel('spine-enrichment-jobs')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'enrichment_jobs',
          },
          () => {
            void tick();
          },
        )
        .subscribe();
    } catch {
      /* realtime optional */
    }

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      if (channel) {
        void createClient().removeChannel(channel);
      }
    };
  }, []);

  const active = jobs.filter(
    (j) => j.status === 'queued' || j.status === 'running',
  );
  if (!active.length) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[70] w-80 space-y-2"
      aria-live="polite"
    >
      {active.slice(0, 3).map((j) => (
        <div
          key={j.id}
          className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-lg"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{j.type}</span>
            <span className="uppercase text-muted-foreground">{j.status}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-[#1B2838] transition-all"
              style={{
                width: `${Math.min(100, Math.max(4, j.progress_pct ?? 8))}%`,
              }}
            />
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
