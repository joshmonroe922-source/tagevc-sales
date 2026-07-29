import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money } from '@/components/af/af-ui';
import { AF_ENTITIES, getNetWorthSnapshot } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function CompanyNetWorthPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs } = await resolveAfEntityParam(searchParams);
  const nw = getNetWorthSnapshot();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Finance · Net Worth"
        title="Company net worth"
        description="Assets − liabilities by entity and consolidated (IC elim). Cash from Operating/Savings/Investments. No card UI here."
        secondaryActions={<AfBackLink href={`/shared-services/af/finance${qs}`} label="Finance" />}
      />

      <div className="rounded-2xl border border-border bg-gradient-to-br from-[#f8f7f4] via-white to-[#eef2f7] px-6 py-6">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Consolidated</p>
        <p className="mt-2 font-heading text-4xl font-semibold text-[#3a414f]"><Money value={nw.consolidated.netWorth} /></p>
        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          <div><p className="text-muted-foreground">Cash</p><p className="font-medium"><Money value={nw.consolidated.cash} /></p></div>
          <div><p className="text-muted-foreground">Assets</p><p className="font-medium"><Money value={nw.consolidated.totalAssets} /></p></div>
          <div><p className="text-muted-foreground">Liabilities</p><p className="font-medium"><Money value={nw.consolidated.totalLiabilities} /></p></div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Personal books (PERS) excluded · IC Due From/To eliminated</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {AF_ENTITIES.map((e) => {
          const row = nw.byEntity[e.code];
          return (
            <div key={e.code} className="rounded-xl border border-border px-4 py-4">
              <p className="font-heading text-lg font-semibold text-[#3a414f]">{e.legalName}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums"><Money value={row.netWorth} /></p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div><p className="text-muted-foreground">Cash</p><Money value={row.cash} /></div>
                <div><p className="text-muted-foreground">Assets</p><Money value={row.totalAssets} /></div>
                <div><p className="text-muted-foreground">Liab.</p><Money value={row.totalLiabilities} /></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
