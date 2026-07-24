'use client';

import { useState, useTransition } from 'react';
import { refreshHomeBriefingAction } from '@/app/(app)/home/actions';
import { Button } from '@/components/ui/button';
import type { HomeBriefing } from '@/lib/home/briefing';
import { LocalDateTime } from '@/components/ui/local-datetime';

export function HomeBriefingCard({ initial }: { initial: HomeBriefing }) {
  const [briefing, setBriefing] = useState(initial);
  const [pending, startTransition] = useTransition();

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg text-foreground">
            AI daily briefing
          </h2>
          <p className="text-xs text-muted-foreground">
            {briefing.source === 'live' ? 'Live' : 'Fallback'} ·{' '}
            <LocalDateTime value={briefing.generatedAt} variant="datetime" />
            {briefing.model ? ` · ${briefing.model}` : ''}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              const res = await refreshHomeBriefingAction();
              if (res.ok) setBriefing(res.briefing);
            });
          }}
        >
          {pending ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {briefing.text}
      </div>
    </section>
  );
}
