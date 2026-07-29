import Link from 'next/link';
import { CommandCenterBoardsClient } from '@/components/command-center/command-center-boards-client';
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
import { formatUsdK } from '@/lib/format';
import { getIesFinanceReport } from '@/lib/ies/report';
import {
  canManageIesConnections,
  canRefreshIesSnapshots,
} from '@/lib/ies/ux';
import { getSessionContext } from '@/lib/rbac/session';
import { roleHasPermission } from '@/lib/types/roles';
import { APP_ROLE_LABELS } from '@/lib/types';
import { redirect } from 'next/navigation';

const MODULE_QUICK_NAV = [
  { href: '/think-tank', label: 'Think Tank' },
  { href: '/deal-flow', label: 'Deal Flow' },
  { href: '/deal-flow/vc', label: 'VC pipeline' },
  { href: '/deal-flow/vc/intake', label: 'Lead Intake' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/shared-services', label: 'Shared Services' },
  { href: '/shared-services/af/finance', label: 'Tage VC A&F Finance' },
  { href: '/shared-services/legal', label: 'Legal' },
  { href: '/shared-services/marketing', label: 'Marketing' },
  { href: '/firm', label: 'Firm' },
  { href: '/documents', label: 'Document Library' },
  { href: '/shared-services/legal/docusign', label: 'DocuSign' },
  { href: '/entities', label: 'Entities' },
  { href: '/entities/ENT-R619#rollup', label: 'Recruit 619' },
  { href: '/activity', label: 'Activity' },
  { href: '/messages', label: 'Message Center' },
  { href: '/settings/notifications', label: 'Notifications' },
] as const;

export default async function CommandCenterPage() {
  const session = await getSessionContext();
  // COO (subsidiaries) — nav + route gate; Home/Dashboard remain.
  if (session?.profile.role === 'coo') {
    redirect('/dashboard');
  }

  const [snap, companies, activityResult, firmOps, iesReport] =
    await Promise.all([
      getCommandCenterSnapshot(),
      listActivePortfolioCompanies(),
      listRecentActivity(8),
      getFirmOpsCommandPhase61Report(),
      getIesFinanceReport().catch(() => null),
    ]);
  const profile = session?.profile ?? null;
  const activity = activityResult.events;
  const canWriteFirmOps = Boolean(
    session &&
      roleHasPermission(session.profile.role, 'write:shared_services'),
  );
  const canConnectIes = Boolean(
    session && canManageIesConnections(session.profile.role),
  );
  const canRefreshIes = Boolean(
    session && canRefreshIesSnapshots(session.profile.role),
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
          action queues. Money is never auto-approved. Use Cards | List on each
          board.
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

      <CommandCenterBoardsClient
        snap={snap}
        canConnectIes={canConnectIes}
        canRefreshIes={canRefreshIes}
        iesConfigured={iesReport?.configured ?? false}
        iesSyncEnabled={iesReport?.sync_enabled ?? false}
        iesLastSyncedAt={
          iesReport?.last_sync?.finished_at ??
          iesReport?.last_sync?.started_at ??
          null
        }
      />

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
