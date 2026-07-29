import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink } from '@/components/af/af-ui';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function Page({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs } = await resolveAfEntityParam(searchParams);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Finance"
        title="Reports & KPIs"
        description="Entity + consolidated P&L, BS, CF, aging with full time filters."
        secondaryActions={<AfBackLink href={`/shared-services/af/finance${qs}`} label="Finance" />}
      />
      <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
        Module scaffold live — engine depth continues in next build slice (Spec - Forecast & Loans / Reporting KPIs).
      </div>
    </div>
  );
}
