import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, AfModuleGrid } from '@/components/af/af-ui';
import { ACCOUNTING_MODULES } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function AccountingHubPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, firmWide, qs } = await resolveAfEntityParam(searchParams);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Tage VC A&F · Accounting"
        title="Accounting"
        context={entityId ? `Entity · ${entityId}` : firmWide ? 'Firm-wide' : undefined}
        description="Books, close, GL, AR/AP, banks, commissions, and intercompany."
        secondaryActions={<AfBackLink href={`/shared-services/af${qs}`} label="Tage VC A&F" />}
      />
      <AfModuleGrid modules={ACCOUNTING_MODULES} qs={qs} />
    </div>
  );
}
