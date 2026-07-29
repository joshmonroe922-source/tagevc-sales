import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import {
  AF_RBAC_MATRIX,
  listAfControls,
} from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function ControlsPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, firmWide, qs } = await resolveAfEntityParam(searchParams);
  const controls = await listAfControls();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Tage VC A&F · Controls"
        title="Controls, Security & Governance"
        context={entityId ? `Entity · ${entityId}` : firmWide ? 'Firm-wide' : undefined}
        description="SOC2-oriented control catalog, Spec RBAC matrix, and SoD (Prepare ≠ Approve+Pay)."
        secondaryActions={<AfBackLink href={`/shared-services/af${qs}`} label="Tage VC A&F" />}
      />

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Control catalog
        </h2>
        <ul className="space-y-2">
          {controls.map((c) => (
            <li
              key={c.controlId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#3a414f]">
                  {c.controlId} · {c.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.domain}
                  {c.sodRelevant ? ' · SoD' : ''} — {c.description}
                </p>
              </div>
              <StatusPill status={c.status} />
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          RBAC matrix
        </h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-3">Capability</th>
                <th className="px-3 py-3">User</th>
                <th className="px-3 py-3">Mgr</th>
                <th className="px-3 py-3">Acct</th>
                <th className="px-3 py-3">Ctrl</th>
                <th className="px-3 py-3">Fin</th>
                <th className="px-3 py-3">Admin</th>
                <th className="px-3 py-3">Auditor</th>
              </tr>
            </thead>
            <tbody>
              {AF_RBAC_MATRIX.map((row) => (
                <tr key={row.capability} className="border-t border-border/70">
                  <td className="px-3 py-2.5 font-medium">{row.capability}</td>
                  <td className="px-3 py-2.5">{row.entityUser}</td>
                  <td className="px-3 py-2.5">{row.entityMgr}</td>
                  <td className="px-3 py-2.5">{row.accountant}</td>
                  <td className="px-3 py-2.5">{row.controller}</td>
                  <td className="px-3 py-2.5">{row.finance}</td>
                  <td className="px-3 py-2.5">{row.admin}</td>
                  <td className="px-3 py-2.5">{row.auditor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          *SoD: same user cannot Prepare and Approve+Pay the same payment batch.
          Personal Finance is Visionary-only (Josh), not general Admin.
        </p>
      </section>
    </div>
  );
}
