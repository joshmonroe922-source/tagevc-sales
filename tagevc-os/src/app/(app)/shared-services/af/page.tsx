import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { AfModuleGrid, Money, StatusPill } from '@/components/af/af-ui';
import { ACCOUNTING_MODULES, FINANCE_MODULES, AF_ENTITIES, getSetupProgress, getNetWorthSnapshot } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function TageVcAfHubPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, firmWide, qs } = await resolveAfEntityParam(searchParams);
  const progress = getSetupProgress();
  const nw = getNetWorthSnapshot();

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Shared Services · Tage VC A&F"
        title="Tage VC A&F"
        context={entityId ? `Entity · ${entityId}` : firmWide ? 'Firm-wide' : undefined}
        description="In-house accounting & finance — GL, banks, AR/AP, waterfall, net worth, and go-live setup."
        primaryAction={
          <Link
            href={`/shared-services/af/setup${qs}`}
            className="inline-flex h-9 items-center rounded-md bg-[#3a414f] px-3 text-sm font-medium text-white hover:bg-[#2f3540]"
          >
            Go-Live Setup · {progress.overallPct}%
          </Link>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {AF_ENTITIES.map((e) => {
          const row = nw.byEntity[e.code];
          return (
            <div
              key={e.code}
              className="rounded-xl border border-border/70 bg-gradient-to-b from-white to-[#f5f6f8] px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[#3a414f]">{e.legalName}</p>
                <StatusPill status={progress.entityPct[e.code] === 100 ? 'Done' : 'In progress'} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Cash</p>
              <p className="font-heading text-xl font-semibold text-[#3a414f]">
                <Money value={row.cash} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                NW <Money value={row.netWorth} />
              </p>
            </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold text-[#3a414f]">Accounting</h2>
            <p className="text-sm text-muted-foreground">System of record</p>
          </div>
          <Link href={`/shared-services/af/accounting${qs}`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            Open hub →
          </Link>
        </div>
        <AfModuleGrid modules={ACCOUNTING_MODULES} qs={qs} />
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold text-[#3a414f]">Finance</h2>
            <p className="text-sm text-muted-foreground">Planning · forecasts · capital</p>
          </div>
          <Link href={`/shared-services/af/finance${qs}`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            Open hub →
          </Link>
        </div>
        <AfModuleGrid modules={FINANCE_MODULES} qs={qs} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Link href={`/shared-services/af/audit${qs}`} className="rounded-xl border border-border px-4 py-5 hover:bg-muted/30">
          <p className="font-heading text-lg font-semibold text-[#3a414f]">Audit</p>
          <p className="mt-1 text-sm text-muted-foreground">Assurance · PBC · auditor packages</p>
        </Link>
        <Link href={`/shared-services/af/controls${qs}`} className="rounded-xl border border-border px-4 py-5 hover:bg-muted/30">
          <p className="font-heading text-lg font-semibold text-[#3a414f]">Controls, Security & Governance</p>
          <p className="mt-1 text-sm text-muted-foreground">RBAC · SoD · policies</p>
        </Link>
      </section>
    </div>
  );
}
