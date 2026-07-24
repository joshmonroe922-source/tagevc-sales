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

/** Top-of-hub command strip: readiness + center ops shortcuts. */
export function SsHubCommandStrip({ glance }: Props) {
  const ops = getSsCenterOpsModules();

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            SSC command
          </h2>
          <p className="text-sm text-muted-foreground">
            Firm readiness for {glance.period_key} · Tage is the system of
            action for parent and subsidiaries.
          </p>
        </div>
        <Badge className={riskClass(glance.risk_badge)}>
          {glance.risk_badge} risk
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Completion</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {glance.completion_pct}%
            </CardTitle>
          </CardHeader>
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
            <Card className="h-full transition-colors group-hover:border-[#3a414f]/40">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">Center</Badge>
                  <Badge>Live</Badge>
                </div>
                <CardTitle className="font-heading text-base">
                  {m.title}
                </CardTitle>
                <CardDescription>{m.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm font-medium text-[#3a414f]">
                Open →
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {glance.functions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {glance.functions.map((f) => (
            <Link
              key={f.function_key}
              href={`/shared-services/checklists?function=${f.function_key}&period=monthly&scope=parent_subs&time=current`}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-[#3a414f]/40"
            >
              {functionLabel(f.function_key as 'finance')} ·{' '}
              {f.completion_pct}%
              {f.overdue_tasks > 0 ? ` · ${f.overdue_tasks} overdue` : ''}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
