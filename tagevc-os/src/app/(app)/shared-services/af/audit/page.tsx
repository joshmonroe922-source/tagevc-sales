import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink } from '@/components/af/af-ui';
import { ModuleLinkBoard } from '@/components/platform/module-link-board';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function AuditPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, firmWide, qs } = await resolveAfEntityParam(searchParams);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Tage VC A&F · Audit"
        title="Audit"
        context={entityId ? `Entity · ${entityId}` : firmWide ? 'Firm-wide' : undefined}
        description="Assurance workspace, PBC requests, and one-click auditor packages."
        secondaryActions={<AfBackLink href={`/shared-services/af${qs}`} label="Tage VC A&F" />}
      />
      <ModuleLinkBoard
        surface="af-audit-modules"
        columns={2}
        variant="plain"
        items={[
          {
            id: 'workspace',
            label: 'Annual audit workspace',
            href: `/shared-services/af/audit/workspace${qs}`,
            description: 'Auditor view · snapshots · download package',
          },
          {
            id: 'pbc',
            label: 'PBC checklist',
            href: `/shared-services/af/audit/workspace${qs}`,
            description: 'Startup audit readiness · Spec - Audit & Controls',
          },
        ]}
      />
    </div>
  );
}
