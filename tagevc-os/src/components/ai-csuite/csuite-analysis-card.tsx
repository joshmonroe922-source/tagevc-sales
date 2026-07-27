'use client';

import { useState, useTransition } from 'react';
import { refreshCsuiteBriefingAction } from '@/app/(app)/c-suite/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LocalDateTime } from '@/components/ui/local-datetime';
import type { CsuiteBriefing } from '@/lib/ai-csuite/briefing';
import type { AiCsuiteNavRole } from '@/lib/ai-csuite/roles';

function healthBadgeVariant(
  status: CsuiteBriefing['health_status'],
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'green') return 'default';
  if (status === 'red') return 'destructive';
  return 'secondary';
}

export function CsuiteAnalysisCard({
  role,
  initial,
}: {
  role: AiCsuiteNavRole;
  initial: CsuiteBriefing;
}) {
  const [briefing, setBriefing] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [hintDismissed, setHintDismissed] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h2 className="font-heading text-lg text-foreground">AI Analysis</h2>
          <p className="text-xs text-muted-foreground">
            {briefing.source === 'live'
              ? 'Live'
              : briefing.source === 'cached'
                ? 'Cached'
                : 'Fallback'}{' '}
            · <LocalDateTime value={briefing.as_of} variant="datetime" />
            {briefing.model ? ` · ${briefing.model}` : ''}
            {briefing.from_cache ? ' · reuse TTL' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={healthBadgeVariant(briefing.health_status)}>
            {briefing.health_status}
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const res = await refreshCsuiteBriefingAction(role);
                if (res.ok && 'briefing' in res) setBriefing(res.briefing);
              });
            }}
          >
            {pending ? 'Refreshing…' : 'Refresh analysis'}
          </Button>
        </div>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-foreground">
        {briefing.summary}
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            What matters
          </p>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {briefing.what_matters.map((b, i) => (
              <li key={`${i}-${b.slice(0, 24)}`}>{b}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Top risk
          </p>
          <p className="text-sm">{briefing.top_risk}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Primary action
          </p>
          <p className="text-sm">{briefing.primary_action}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Draft-only — human confirm
          </p>
        </div>
      </div>

      {briefing.data_gaps.length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Partial data: {briefing.data_gaps.slice(0, 5).join(' · ')}
          {briefing.data_gaps.length > 5 ? '…' : ''}
        </p>
      ) : null}

      {briefing.persist_hint && !hintDismissed ? (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-2 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <p>{briefing.persist_hint}</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setHintDismissed(true)}
          >
            Dismiss
          </Button>
        </div>
      ) : null}

      {role === 'cfo' && briefing.financial_report_md ? (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-2 font-heading text-base text-foreground">
            Financial Report
          </h3>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {briefing.financial_report_md}
          </div>
        </div>
      ) : null}
    </section>
  );
}
