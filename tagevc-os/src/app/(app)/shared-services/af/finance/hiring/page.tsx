import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money, StatusPill } from '@/components/af/af-ui';
import {
  SEED_HIRE_PLANS,
  assessAllHires,
  getAfStore,
} from '@/lib/af';
import type { EntityCode } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function HiringPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs, entityId } = await resolveAfEntityParam(searchParams);
  const store = getAfStore();
  const rows = assessAllHires(
    SEED_HIRE_PLANS,
    store.allocationLedger,
    (entityId as EntityCode) || null,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Finance"
        title="Hiring estimator"
        description="Fully-loaded annual cost vs waterfall department envelopes (DIR · SALES · MKT · GA · TECH · PROFIT share)."
        secondaryActions={
          <AfBackLink href={`/shared-services/af/finance${qs}`} label="Finance" />
        }
      />

      {store.allocationLedger.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">
          No waterfall envelopes yet — mark an invoice Paid to fund department
          hiring buckets, then reassess affordability.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Dept</th>
              <th className="px-4 py-3 text-right">Fully loaded / yr</th>
              <th className="px-4 py-3 text-right">Envelope</th>
              <th className="px-4 py-3 text-right">Months</th>
              <th className="px-4 py-3">Health</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.plan.id} className="border-t border-border/70">
                <td className="px-4 py-3 font-medium">{r.plan.title}</td>
                <td className="px-4 py-3">{r.plan.entityCode}</td>
                <td className="px-4 py-3">{r.plan.dept}</td>
                <td className="px-4 py-3 text-right">
                  <Money value={r.fullyLoadedAnnual} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Money value={r.envelopeAvailable} />
                </td>
                <td className="px-4 py-3 text-right">{r.monthsCovered}</td>
                <td className="px-4 py-3">
                  <StatusPill status={r.health} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
