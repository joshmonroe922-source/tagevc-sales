import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getFirmHomeSnapshot } from '@/lib/firm-ops/firm-home';
import { formatUsdK } from '@/lib/format';
import { requirePermission } from '@/lib/rbac/session';

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const LINKS = [
  { href: '/command-center', label: 'Command Center' },
  { href: '/deal-flow', label: 'Deal Flow' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/entities', label: 'Companies' },
  { href: '/shared-services', label: 'Shared Services' },
  { href: '/shared-services/hr/employees', label: 'HRIS' },
  { href: '/entities/ENT-R619', label: 'Recruit 619' },
  { href: '/entities/ENT-INDA', label: 'Instant NDA' },
  { href: '/activity', label: 'Activity' },
] as const;

export default async function FirmPage() {
  await requirePermission('read:firm');
  const firm = await getFirmHomeSnapshot();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Firm
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Tage operating home
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Parent snapshot across companies, shared services readiness,
          leadership queues, and capital pulse — in plain language.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Active companies"
          value={firm.company_count}
          hint={`${firm.subsidiary_count} subsidiaries in registry`}
        />
        <Metric
          label="Open pipeline"
          value={firm.open_leads + firm.open_deals}
          hint={`${firm.open_leads} leads · ${firm.open_deals} deals`}
        />
        <Metric
          label="SSC this month"
          value={`${Math.round(firm.ssc_completion_pct)}%`}
          hint={`${firm.ssc_overdue} overdue checklist items`}
        />
        <Metric
          label="Approvals & risks"
          value={firm.draft_approvals + firm.p0_risks}
          hint={`${firm.draft_approvals} drafts · ${firm.p0_risks} P0 · ${firm.escalated_tickets} escalated`}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active companies</CardTitle>
            <CardDescription>
              Portfolio companies currently in operating view.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {firm.companies.length === 0 ? (
              <p className="text-muted-foreground">No active companies yet.</p>
            ) : (
              firm.companies.map((c) => (
                <Link
                  key={c.id}
                  href={c.href}
                  className="flex justify-between gap-2 rounded-md border border-border px-3 py-2 hover:bg-muted/40"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">Open →</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registry companies</CardTitle>
            <CardDescription>
              Parent and subsidiaries with Shared Services scope.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {firm.subsidiaries.length === 0 ? (
              <p className="text-muted-foreground">No subsidiaries listed.</p>
            ) : (
              firm.subsidiaries.map((s) => (
                <Link
                  key={s.entity_id}
                  href={s.href}
                  className="flex justify-between gap-2 rounded-md border border-border px-3 py-2 hover:bg-muted/40"
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">Open →</span>
                </Link>
              ))
            )}
            {firm.hris_onboarding > 0 ? (
              <p className="pt-1 text-xs text-muted-foreground">
                {firm.hris_onboarding} people in HRIS onboarding —{' '}
                <Link
                  href="/shared-services/hr/employees"
                  className="underline-offset-4 hover:underline"
                >
                  view HRIS
                </Link>
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leadership priorities</CardTitle>
            <CardDescription>
              Top items from Visionary, COO, and service-lead queues.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {firm.leadership.length === 0 ? (
              <p className="text-muted-foreground">
                No open leadership queue items. Refresh from Command Center when
                ops boards are connected.
              </p>
            ) : (
              firm.leadership.map((item) => (
                <Link
                  key={item.id}
                  href={item.href || '/command-center'}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 hover:bg-muted/40"
                >
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {item.audience.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <Badge variant="secondary">{item.count}</Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shared Services readiness</CardTitle>
            <CardDescription>
              Parent + subsidiaries checklist health for this month.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                Completion {Math.round(firm.ssc_completion_pct)}%
              </Badge>
              <Badge
                variant={firm.ssc_overdue > 0 ? 'destructive' : 'secondary'}
              >
                Overdue {firm.ssc_overdue}
              </Badge>
              <Badge
                variant={firm.draft_approvals > 0 ? 'secondary' : 'outline'}
              >
                Draft approvals {firm.draft_approvals}
              </Badge>
            </div>
            <Link
              href="/shared-services"
              className="inline-flex text-sm font-medium underline-offset-4 hover:underline"
            >
              Open Shared Services Center →
            </Link>
            <div className="border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">Capital pulse</p>
              <p className="mt-1 tabular-nums">
                Portfolio{' '}
                {firm.capital.portfolio_cash_k != null
                  ? formatUsdK(firm.capital.portfolio_cash_k)
                  : '—'}{' '}
                · Firm{' '}
                {firm.capital.firm_cash_k != null
                  ? formatUsdK(firm.capital.firm_cash_k)
                  : '—'}
                {firm.capital.min_runway_months != null
                  ? ` · min runway ${firm.capital.min_runway_months} mo`
                  : ''}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Jump links</CardTitle>
            <CardDescription>
              Capital, portfolio, deal flow, and company records.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
              >
                {l.label}
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent firm activity</CardTitle>
            <CardDescription>
              Latest operating events across modules.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {firm.activity.length === 0 ? (
              <p className="text-muted-foreground">No recent activity.</p>
            ) : (
              firm.activity.map((ev) => (
                <div
                  key={ev.id}
                  className="flex flex-wrap justify-between gap-2 border-b border-border/50 py-1.5"
                >
                  {ev.href ? (
                    <Link
                      href={ev.href}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {ev.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{ev.title}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {ev.created_at.slice(0, 10)}
                  </span>
                </div>
              ))
            )}
            <Link
              href="/activity"
              className="inline-flex text-xs underline-offset-4 hover:underline"
            >
              Full activity →
            </Link>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
