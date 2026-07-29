import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { AfModuleGrid, Money, StatusPill } from '@/components/af/af-ui';
import { ModuleLinkBoard } from '@/components/platform/module-link-board';
import {
  ACCOUNTING_MODULES,
  FINANCE_MODULES,
  AF_ENTITIES,
  getSetupProgress,
  getNetWorthSnapshot,
} from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function TageVcAfHubPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, firmWide, qs } = await resolveAfEntityParam(searchParams);
  const progress = getSetupProgress();
  const nw = getNetWorthSnapshot();

  const entityItems = AF_ENTITIES.map((e) => {
    const row = nw.byEntity[e.code];
    return {
      id: e.code,
      label: e.legalName,
      href: `/shared-services/af?entity=${e.code}`,
      description: `NW · setup ${progress.entityPct[e.code]}%`,
      meta: new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(row.cash),
    };
  });

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Shared Services · Tage VC A&F"
        title="Tage VC A&F"
        context={entityId ? `Entity · ${entityId}` : firmWide ? 'Firm-wide' : undefined}
        description="In-house accounting & finance — GL, banks, AR/AP, waterfall, net worth, and go-live setup. Use Cards | List on each board."
        primaryAction={
          <Link
            href={`/shared-services/af/setup${qs}`}
            className="inline-flex h-9 items-center rounded-md bg-[#3a414f] px-3 text-sm font-medium text-white hover:bg-[#2f3540]"
          >
            Go-Live Setup · {progress.overallPct}%
          </Link>
        }
      />

      <ModuleLinkBoard
        surface="af-hub-entities"
        variant="metric"
        columns={4}
        items={entityItems}
      />

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
              Accounting
            </h2>
            <p className="text-sm text-muted-foreground">System of record</p>
          </div>
          <Link
            href={`/shared-services/af/accounting${qs}`}
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Open hub →
          </Link>
        </div>
        <AfModuleGrid
          modules={ACCOUNTING_MODULES}
          qs={qs}
          surface="af-hub-accounting"
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
              Finance
            </h2>
            <p className="text-sm text-muted-foreground">
              Planning · forecasts · capital
            </p>
          </div>
          <Link
            href={`/shared-services/af/finance${qs}`}
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Open hub →
          </Link>
        </div>
        <AfModuleGrid
          modules={FINANCE_MODULES}
          qs={qs}
          surface="af-hub-finance"
        />
      </section>

      <ModuleLinkBoard
        surface="af-hub-assurance"
        columns={2}
        variant="plain"
        items={[
          {
            id: 'audit',
            label: 'Audit',
            href: `/shared-services/af/audit${qs}`,
            description: 'Assurance · PBC · auditor packages',
          },
          {
            id: 'controls',
            label: 'Controls, Security & Governance',
            href: `/shared-services/af/controls${qs}`,
            description: 'RBAC · SoD · policies',
          },
        ]}
      />

      <p className="text-xs text-muted-foreground">
        Consolidated NW <Money value={nw.consolidated.netWorth} /> ·{' '}
        <StatusPill
          status={progress.productionUnlocked ? 'Done' : 'In progress'}
        />{' '}
        go-live
      </p>
    </div>
  );
}
