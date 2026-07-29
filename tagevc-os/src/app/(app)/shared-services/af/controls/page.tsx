import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

const ROLES = [
  { role: 'Visionary', access: 'Full A&F + Personal Finance' },
  { role: 'Controller', access: 'GL · close · approvals · reports' },
  { role: 'Accountant', access: 'AR/AP · banks · JE (limited)' },
  { role: 'Entity Manager', access: 'Entity-scoped read + invoice send' },
  { role: 'Auditor', access: 'Read-only workspace + PBC' },
];

export default async function ControlsPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, firmWide, qs } = await resolveAfEntityParam(searchParams);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Tage VC A&F · Controls"
        title="Controls, Security & Governance"
        context={entityId ? `Entity · ${entityId}` : firmWide ? 'Firm-wide' : undefined}
        description="RBAC matrix, segregation of duties, and SOC2-oriented control catalog."
        secondaryActions={<AfBackLink href={`/shared-services/af${qs}`} label="Tage VC A&F" />}
      />
      <ul className="space-y-2">
        {ROLES.map((r) => (
          <li
            key={r.role}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-[#3a414f]">{r.role}</p>
              <p className="text-xs text-muted-foreground">{r.access}</p>
            </div>
            <StatusPill status="On Track" />
          </li>
        ))}
      </ul>
    </div>
  );
}
