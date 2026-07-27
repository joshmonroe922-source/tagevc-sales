import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getSsCenterOpsModules } from '@/lib/shared-services/modules';
import type { SscHubGlance } from '@/lib/shared-services/ssc-checklist/hub-glance';
import { functionLabel } from '@/lib/shared-services/ssc-checklist/types';

function riskClass(b: SscHubGlance['risk_badge']) {
  if (b === 'green') return 'bg-emerald-100 text-emerald-800';
  if (b === 'amber') return 'bg-amber-100 text-amber-900';
  return 'bg-red-100 text-red-800';
}

type Props = {
  glance: SscHubGlance;
};

/** Top-of-hub command strip: readiness + center ops + trends. */
export function SsHubCommandStrip({ glance }: Props) {
  const ops = getSsCenterOpsModules();
  const allTrend = glance.trends.find((t) => t.function_key === 'all');

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            SSC command
          </h2>
          <p className="text-sm text-muted-foreground">
            Daily control surface for Shared Services leaders ·{' '}
            {glance.period_key} · Tage runs parent + subsidiaries.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={riskClass(glance.risk_badge)}>
            {glance.risk_badge} risk
          </Badge>
          {glance.last_cadence ? (
            <Badge variant="outline">
              Cadence {glance.last_cadence.ok ? 'ok' : 'failed'} ·{' '}
              {glance.last_cadence.run_kind} ·{' '}
              {glance.last_cadence.started_at.slice(0, 16).replace('T', ' ')}
            </Badge>
          ) : (
            <Badge variant="outline">Cadence pending first cron</Badge>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Completion</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {glance.completion_pct}%
            </CardTitle>
          </CardHeader>
          {allTrend ? (
            <CardContent className="pt-0 font-mono text-lg tracking-tight text-muted-foreground">
              {allTrend.sparkline
                .map((v) => {
                  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
                  const idx = Math.max(
                    0,
                    Math.min(
                      7,
                      Math.round((v / 100) * 7),
                    ),
                  );
                  return blocks[idx];
                })
                .join('')}
            </CardContent>
          ) : null}
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Overdue</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {glance.overdue_tasks}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Blocked</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {glance.blocked_tasks}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Audit open</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {glance.audit_open_items}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Escalated tickets</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {glance.escalations_open}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {ops.map((m) => (
          <Link key={m.id} href={m.href} className="group block">
            <Card className="h-full border-[#3a414f]/25 transition-colors group-hover:border-[#3a414f]/50">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge>Daily</Badge>
                  <Badge variant="outline">Center</Badge>
                </div>
                <CardTitle className="font-heading text-base">
                  {m.title}
                </CardTitle>
                <CardDescription>{m.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm font-medium text-[#3a414f]">
                Open control surface →
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {glance.functions.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Function trend (monthly)
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {glance.functions.map((f) => (
              <Link
                key={f.function_key}
                href={`/shared-services/checklists?function=${f.function_key}&period=monthly&scope=parent_subs&time=active`}
                className="rounded-md border border-border px-3 py-2 text-sm hover:border-[#3a414f]/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {functionLabel(f.function_key as 'finance')}
                  </span>
                  <span className="tabular-nums">{f.completion_pct}%</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono tracking-tight">
                    {f.sparkline || '—'}
                  </span>
                  <span>
                    {f.overdue_tasks > 0
                      ? `${f.overdue_tasks} overdue`
                      : 'on track'}
                    {f.delta_completion != null
                      ? ` · ${f.delta_completion >= 0 ? '+' : ''}${f.delta_completion}pts`
                      : ''}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
