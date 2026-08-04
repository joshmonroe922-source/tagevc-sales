import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, AfModuleGrid, Money } from '@/components/af/af-ui';
import { FINANCE_MODULES, getNetWorthSnapshot } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { entityScopeContext } from '@/lib/entities/display-name';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function FinanceHubPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, firmWide, qs } = await resolveAfEntityParam(searchParams);
  const nw = getNetWorthSnapshot();
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Tage VC A&F · Finance"
        title="Finance"
        context={
          entityId
            ? entityScopeContext(entityId)
            : firmWide
              ? 'Firm-wide'
              : undefined
        }
        description="Budgets, AI forecasts, cash, loans, hiring envelopes, and company net worth."
        secondaryActions={<AfBackLink href={`/shared-services/af${qs}`} label="Tage VC A&F" />}
      />
      <div className="rounded-xl border border-border/70 bg-gradient-to-r from-[#f7f6f3] to-[#eef2f7] px-5 py-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Consolidated company NW</p>
        <p className="font-heading text-3xl font-semibold text-[#3a414f]"><Money value={nw.consolidated.netWorth} /></p>
        <p className="mt-1 text-sm text-muted-foreground">Cash <Money value={nw.consolidated.cash} /> · IC eliminations applied · personal books excluded</p>
      </div>
      <AfModuleGrid modules={FINANCE_MODULES} qs={qs} surface="af-finance-modules" />
    </div>
  );
}
