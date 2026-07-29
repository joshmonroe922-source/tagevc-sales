import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink } from '@/components/af/af-ui';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function AuditWorkspacePage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs } = await resolveAfEntityParam(searchParams);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Audit"
        title="Auditor workspace"
        description="Read-only snapshots and export packages for external auditors."
        secondaryActions={
          <AfBackLink href={`/shared-services/af/audit${qs}`} label="Audit" />
        }
      />
      <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
        Snapshot export hooks into continuous close + document store in hardening phase.
      </div>
    </div>
  );
}
