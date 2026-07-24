import Link from 'next/link';
import { FirmOpsCommandPhase61Client } from '@/components/firm-ops/firm-ops-command-phase61-client';
import { HealthBadge } from '@/components/portfolio/health-badge';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { listRecentActivity } from '@/lib/data/activity';
import {
  getCommandCenterSnapshot,
  listActivePortfolioCompanies,
} from '@/lib/data/repositories';
import { getFirmOpsCommandPhase61Report } from '@/lib/firm-ops/firm-ops-command-phase61-server';
import {
  formatPct,
  formatRunway,
  formatUsdK,
} from '@/lib/format';
import { getSessionContext } from '@/lib/rbac/session';
import { roleHasPermission } from '@/lib/types/roles';
import { APP_ROLE_LABELS, PORTFOLIO_HEALTH } from '@/lib/types';

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

const MODULE_QUICK_NAV = [
  { href: '/think-tank', label: 'Think Tank' },
  { href: '/deal-flow', label: 'Deal Flow' },
  { href: '/deal-flow/vc', label: 'VC pipeline' },
  { href: '/deal-flow/vc/intake', label: 'Lead Intake' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/shared-services', label: 'Shared Services' },
  { href: '/shared-services/finance', label: 'Finance' },
  { href: '/shared-services/legal/docusign', label: 'Legal' },
  { href: '/shared-services/marketing', label: 'Marketing' },
  { href: '/firm', label: 'Firm' },
  { href: '/documents', label: 'Document Library' },
  { href: '/entities', label: 'Entities' },
  { href: '/entities/ENT-R619#rollup', label: 'Recruit 619' },
  { href: '/activity', label: 'Activity' },
  { href: '/messages', label: 'Message Center' },
  { href: '/settings/notifications', label: 'Notifications' },
] as const;

export default async function CommandCenterPage() {
  const [session, snap, companies, activityResult, firmOps] =
    await Promise.all([
      getSessionContext(),
      getCommandCenterSnapshot(),
      listActivePortfolioCompanies(),
      listRecentActivity(8),
      getFirmOpsCommandPhase61Report(),
    ]);
  const profile = session?.profile ?? null;
  const activity = activityResult.events;
  const canWriteFirmOps = Boolean(
    session &&
      roleHasPermission(session.profile.role, 'write:shared_services'),
  );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
            Command Center
          </h1>
          <Badge variant="outline" className="font-normal">
            {snap.freshness}
          </Badge>
          {snap.period ? (
            <Badge variant="secondary" className="font-normal">
              Period {snap.period}
            </Badge>
          ) : null}
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Firm health at a glance — funnel, capital, portfolio attention, and
          action queues. Money is never auto-approved.
          {profile ? (
            <>
              {' '}
              Signed in as{' '}
              <span className="text-foreground">
                {APP_ROLE_LABELS[profile.role]}
              </span>
              .{' '}
              <Link
                href="/home"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Open Home / Think Tank →
              </Link>
            </>
          ) : null}
        </p>
      </header>

      <FirmOpsCommandPhase61Client
        report={firmOps}
        canWrite={canWriteFirmOps}
      />

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-[#7c7871] uppercase">
          Quick links
        </h2>
        <div className="flex flex-wrap gap-2">
          {MODULE_QUICK_NAV.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted"
            >
              {a.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-[#7c7871] uppercase">
          Funnel snapshot
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Metric label="Active leads" value={snap.funnel.active_leads} />
          <Metric label="Ready for DD" value={snap.funnel.ready_for_dd} />
          <Metric label="Open DD tasks" value={snap.funnel.open_dd_tasks} />
          <Metric
            label="Blocked DD tasks"
            value={snap.funnel.blocked_dd_tasks}
          />
          <Metric label="Active deals" value={snap.funnel.active_deals} />
          <Metric
            label="Deals in closing"
            value={snap.funnel.deals_in_closing}
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Portfolio health</CardTitle>
            <CardDescription>
              {snap.active_portfolio_companies} active companies · attention
              required:{' '}
              <span className="font-medium text-foreground">
                {snap.attention_required}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {PORTFOLIO_HEALTH.map((status) => (
              <div
                key={status}
                className="rounded-md border border-border px-3 py-2"
              >
                <div className="mb-1">
                  <HealthBadge health={status} />
                </div>
                <p className="text-xl font-semibold tabular-nums">
                  {snap.portfolio_health[status]}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Capital pulse</CardTitle>
            <CardDescription>
              Portfolio totals with firm cash kept separate, then combined.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Metric
              label="Portfolio ARR ($k)"
              value={formatUsdK(snap.capital.portfolio_arr_k)}
            />
            <Metric
              label="Gross margin"
              value={formatPct(snap.capital.portfolio_gross_margin)}
            />
            <Metric
              label="Net burn ($k)"
              value={formatUsdK(snap.capital.portfolio_net_burn_k)}
            />
            <Metric
              label="Portfolio cash ($k)"
              value={formatUsdK(snap.capital.portfolio_cash_k)}
            />
            <Metric
              label="Firm cash ($k)"
              value={formatUsdK(snap.capital.firm_cash_k)}
            />
            <Metric
              label="Consolidated cash ($k)"
              value={formatUsdK(snap.capital.consolidated_cash_k)}
            />
            <Metric
              label="Min runway"
              value={formatRunway(snap.capital.min_runway_mo)}
              hint={
                snap.capital.runway_breach
                  ? 'REVIEW — at least one sub <12 mo'
                  : 'ok'
              }
            />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">Active companies</CardTitle>
            <CardDescription>
              Current period{snap.period ? ` · ${snap.period}` : ''}.
            </CardDescription>
          </div>
          <Link
            href="/portfolio"
            className="text-sm font-medium text-[#3a414f] underline-offset-4 hover:underline"
          >
            View Dashboard →
          </Link>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {companies.map((c) => (
            <Link
              key={c.portfolio_id}
              href={`/portfolio/${c.portfolio_id}`}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:bg-muted/30"
            >
              <div>
                <p className="font-medium">{c.company_name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.portfolio_id} · ARR ${formatUsdK(c.arr_k)}k · Burn $
                  {formatUsdK(c.net_burn_k)}k
                </p>
              </div>
              <HealthBadge health={c.health} />
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">Recent activity</CardTitle>
            <CardDescription>
              Latest firm-wide actions across pipelines and services.
            </CardDescription>
          </div>
          <Link
            href="/activity"
            className="text-sm font-medium text-[#3a414f] underline-offset-4 hover:underline"
          >
            View all →
          </Link>
        </CardHeader>
        <CardContent className="space-y-2">
          {!activityResult.ok ? (
            <p className="text-sm text-destructive">{activityResult.error}</p>
          ) : activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recent activity yet. Create a lead or ticket to get started.
            </p>
          ) : (
            activity.map((e) => (
              <div
                key={e.event_id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-0"
              >
                <p className="text-sm font-medium text-foreground">{e.title}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(e.created_at).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Operating cadence</CardTitle>
          <CardDescription>Weekly firm rhythm.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Mon</span> — Inbound
              triage (Associate)
            </li>
            <li>
              <span className="font-medium text-foreground">Tue / Thu</span> — DD
              blockers standup (Partner)
            </li>
            <li>
              <span className="font-medium text-foreground">Wed</span> — IC /
              terms / LOI (Partners)
            </li>
            <li>
              <span className="font-medium text-foreground">Fri</span> — Command
              Center pulse (Partner)
            </li>
            <li>
              <span className="font-medium text-foreground">Biweekly</span> —
              Portfolio ops review (COO)
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
