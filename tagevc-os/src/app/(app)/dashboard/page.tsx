import Link from 'next/link';
import { Suspense } from 'react';
import { DashboardPnlPanel } from '@/components/dashboard/dashboard-pnl-panel';
import { DashboardPortfolioBoards } from '@/components/dashboard/dashboard-portfolio-boards';
import { RoleDashboardClient } from '@/components/dashboard/role-dashboard-client';
import { TageVcFirmPerformancePanel } from '@/components/dashboard/tage-vc-firm-performance';
import { OperatingCadencePhase60Client } from '@/components/portfolio/operating-cadence-phase60-client';
import { PortfolioCompaniesTable } from '@/components/portfolio/portfolio-companies-table';
import { ReportingTimeframeBar } from '@/components/reporting/reporting-timeframe-bar';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  buildDashboardPnlView,
  buildTageVcFirmPerformance,
} from '@/lib/dashboard/ies-pnl-view';
import {
  enforcePnlDashboardScope,
  filterCompanyOptionsForPnl,
  filterIesReportForPnlAccess,
  resolvePnlScopeAccess,
} from '@/lib/dashboard/pnl-visibility';
import { buildRoleDashboardCards } from '@/lib/dashboard/role-dashboard-server';
import type { DashboardScopeMode } from '@/lib/dashboard/role-dashboard-catalog';
import { DASHBOARD_VIEW_ROLES } from '@/lib/dashboard/role-dashboard-catalog';
import { getMasterDataSource } from '@/lib/data/master-data';
import {
  listActivePortfolioCompanies,
  listEntities,
  getPortfolioRollup,
} from '@/lib/data/repositories';
import {
  formatPct,
  formatUsdK,
} from '@/lib/format';
import { getIesFinanceReport } from '@/lib/ies/report';
import { getPortfolioOperatingCadencePhase60Report } from '@/lib/portfolio/operating-cadence-phase60-server';
import { normalizeEntityId } from '@/lib/entities/display-name';
import { toVisibleCompanySelectOptions } from '@/lib/entities/registry-visibility';
import {
  canManageIesConnections,
  canRefreshIesSnapshots,
} from '@/lib/ies/ux';
import { getSessionContext } from '@/lib/rbac/session';
import { redirect } from 'next/navigation';
import { roleHasPermission, type AppRole } from '@/lib/types/roles';
import { PageSkeleton } from '@/components/ui/skeleton';

type DashboardWorkspaceProps = {
  role: AppRole | string;
  viewAsRole: AppRole;
  canSwitch: boolean;
  requestedScope: DashboardScopeMode;
  entityRaw: string;
  canWrite: boolean;
  profileEntityId: string | null | undefined;
  profileFullName: string | null | undefined;
};

async function DashboardWorkspace({
  role,
  viewAsRole,
  canSwitch,
  requestedScope,
  entityRaw,
  canWrite,
  profileEntityId,
  profileFullName,
}: DashboardWorkspaceProps) {
  const [companies, entities, rollup, cadenceReport, iesReportRaw] =
    await Promise.all([
      listActivePortfolioCompanies(),
      listEntities().catch(() => []),
      getPortfolioRollup(),
      getPortfolioOperatingCadencePhase60Report(),
      getIesFinanceReport().catch(() => null),
    ]);

  const pnlAccess = resolvePnlScopeAccess({
    role: viewAsRole,
    profileEntityId,
    profileFullName,
    entities,
  });
  const enforced = enforcePnlDashboardScope({
    access: pnlAccess,
    requestedScope,
    requestedEntityId: entityRaw || null,
  });
  const scope = enforced.scope;
  const scopedEntityId = enforced.entityId;

  const roleDash = await buildRoleDashboardCards({
    role: viewAsRole,
    scope,
    entityId: scope === 'company' ? scopedEntityId : null,
  });

  const source = getMasterDataSource();
  const isAdminOpsDash = viewAsRole === 'admin';
  // Company table + roll-up proof: Visionary, Partner, COO (Subsidiaries) only
  const showCompanyRollup = (['visionary', 'partner', 'coo'] as const).includes(
    viewAsRole as 'visionary' | 'partner' | 'coo',
  );
  // Firm portfolio summary strip — hide for Admin ops dashboard
  const showFirmPortfolioSummary = !isAdminOpsDash;

  const iesReport = iesReportRaw
    ? filterIesReportForPnlAccess(iesReportRaw, pnlAccess)
    : null;

  // Live P&L: role-scoped company filter (native IES); no URL bypass
  const showLivePnl = pnlAccess.canViewLivePnl;
  const pnlView = showLivePnl
    ? buildDashboardPnlView({
        report: iesReport,
        scope,
        entityId: scope === 'company' ? scopedEntityId : null,
      })
    : null;
  // Parent firm performance: Visionary + Accounting / Finance only
  const showFirmPerformance = pnlAccess.canViewFirmPerformance;
  const firmPerformance = showFirmPerformance
    ? buildTageVcFirmPerformance(iesReportRaw)
    : null;

  // Registry-visibility filter: drop legacy Instant NDA (ENT-002) + samples;
  // keep canonical ENT-INDA (IES Instant NDA). Dedupes alias/label duplicates.
  // Then apply P&L role scope (COO assigned / sub_lead led).
  const companyOptions = filterCompanyOptionsForPnl(
    toVisibleCompanySelectOptions([
      ...companies.map((c) => ({
        entity_id: c.entity_id,
        company_name: c.company_name || c.entity_id,
      })),
      { entity_id: 'ENT-FIRM', name: 'Tage Venture Capital' },
      { entity_id: 'ENT-R619', name: 'Recruit 619' },
      { entity_id: 'ENT-SIGNENT', name: 'Signent HR' },
      { entity_id: 'ENT-INDA', name: 'Instant NDA' },
    ]),
    pnlAccess,
  );

  const canConnectIes = canManageIesConnections(viewAsRole);
  const canRefreshIes = canRefreshIesSnapshots(viewAsRole);
  const iesConfigured = iesReportRaw?.configured ?? false;
  const iesSyncEnabled = iesReportRaw?.sync_enabled ?? false;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-normal">
          Period {rollup.period}
        </Badge>
        <Badge variant="outline" className="font-normal capitalize">
          {source === 'sql' ? 'Live' : source === 'seed+migrating' ? 'Updating' : 'Sample'}
        </Badge>
      </div>

      <Suspense fallback={null}>
        <RoleDashboardClient
          role={role}
          viewAsRole={viewAsRole}
          canSwitchRoles={canSwitch}
          scope={roleDash.scope}
          selectedEntityId={scopedEntityId}
          companies={companyOptions}
          canViewConsolidated={pnlAccess.canViewConsolidated}
          cards={roleDash.cards}
        />
      </Suspense>

      {showFirmPerformance && firmPerformance ? (
        <TageVcFirmPerformancePanel
          view={firmPerformance}
          canConnect={canConnectIes}
          canRefresh={canRefreshIes}
          configured={iesConfigured}
          syncEnabled={iesSyncEnabled}
        />
      ) : null}

      {showLivePnl && pnlView ? (
        <Suspense fallback={null}>
          <DashboardPnlPanel
            view={pnlView}
            companies={companyOptions}
            canViewConsolidated={pnlAccess.canViewConsolidated}
            canConnect={canConnectIes}
            canRefresh={canRefreshIes}
            configured={iesConfigured}
            syncEnabled={iesSyncEnabled}
          />
        </Suspense>
      ) : null}

      {showFirmPortfolioSummary ? (
        <>
          <OperatingCadencePhase60Client
            report={cadenceReport}
            canWrite={canWrite}
            companyOptions={companyOptions.map((c) => ({
              value: c.entity_id,
              label: c.name,
            }))}
          />

          <DashboardPortfolioBoards
            companyCount={companies.length}
            rollup={rollup}
          />
        </>
      ) : null}

      {showCompanyRollup ? (
        <>
          <PortfolioCompaniesTable companies={companies} />

          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">Roll-up proof</CardTitle>
              <CardDescription>
                SUM of visible company rows · WEIGHTED gross margin from their
                P&L · firm cash only when IES is connected.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                Gross margin{' '}
                <span className="font-medium tabular-nums">
                  {formatPct(rollup.portfolio_gross_margin)}
                </span>
              </div>
              <div>
                Portfolio cash{' '}
                <span className="font-medium tabular-nums">
                  ${formatUsdK(rollup.portfolio_cash_k)}k
                </span>
              </div>
              <div>
                Consolidated cash{' '}
                <span className="font-medium tabular-nums">
                  {rollup.consolidated_cash_k == null
                    ? 'Not Connected'
                    : `$${formatUsdK(rollup.consolidated_cash_k)}k`}
                </span>
                {rollup.firm_cash_k == null ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Firm IES cash not attached
                  </span>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Looking for a company? Open a row for the Subsidiary OS, browse{' '}
            <Link href="/entities" className="underline underline-offset-2">
              Portfolio
            </Link>
            , or jump to{' '}
            <Link href="/command-center" className="underline underline-offset-2">
              Command Center
            </Link>
            .
          </p>
        </>
      ) : null}
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  const dashRole = session?.profile.role ?? '';
  if (
    dashRole.startsWith('ssc_') ||
    dashRole === 'service_lead' ||
    dashRole === 'counsel_ops'
  ) {
    redirect('/to-do');
  }
  const canWrite = Boolean(
    session && roleHasPermission(session.profile.role, 'write:portfolio_health'),
  );
  const sp = (await searchParams) ?? {};
  const scopeRaw = typeof sp.scope === 'string' ? sp.scope : 'consolidated';
  const entityRaw =
    typeof sp.entity === 'string' ? normalizeEntityId(sp.entity.trim()) : '';
  const requestedScope: DashboardScopeMode =
    scopeRaw === 'company' && entityRaw
      ? 'company'
      : scopeRaw === 'by_company'
        ? 'by_company'
        : 'consolidated';
  const asRaw = typeof sp.as === 'string' ? sp.as : '';
  const role = session?.profile.role ?? 'admin';
  const canSwitch = session?.realRole === 'visionary';
  const viewAsRole: AppRole =
    canSwitch && (DASHBOARD_VIEW_ROLES as readonly string[]).includes(asRaw)
      ? (asRaw as AppRole)
      : (role as AppRole);
  const isAdminOpsDash = viewAsRole === 'admin';

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Dashboard
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {isAdminOpsDash
            ? 'Admin operations dashboard — users, tickets, SSC health, documents, and access. Not firm Visionary KPIs.'
            : 'Role-based operating dashboard with goals vs actuals. Portfolio health and weekly review tools remain below. Use Cards | List on each board.'}
        </p>
        <ReportingTimeframeBar defaultPeriod="week" />
      </header>
      <Suspense fallback={<PageSkeleton cards={6} showTable />}>
        <DashboardWorkspace
          role={role}
          viewAsRole={viewAsRole}
          canSwitch={canSwitch}
          requestedScope={requestedScope}
          entityRaw={entityRaw}
          canWrite={canWrite}
          profileEntityId={session?.profile.entity_id}
          profileFullName={session?.profile.full_name}
        />
      </Suspense>
    </div>
  );
}
