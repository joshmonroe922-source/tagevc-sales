import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink } from '@/components/af/af-ui';
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href={`/shared-services/af/audit/workspace${qs}`}
          className="rounded-xl border border-border px-4 py-5 hover:bg-muted/30"
        >
          <p className="font-heading text-lg font-semibold text-[#3a414f]">
            Annual audit workspace
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Auditor view · snapshots · download package
          </p>
        </Link>
        <div className="rounded-xl border border-border px-4 py-5">
          <p className="font-heading text-lg font-semibold text-[#3a414f]">
            PBC checklist
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Startup audit readiness — Spec - Audit & Controls depth next.
          </p>
        </div>
      </div>
    </div>
  );
}
