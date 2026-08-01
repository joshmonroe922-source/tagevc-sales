import Link from 'next/link';
import {
  VmShell,
  VmStat,
  VmTable,
  money,
} from '@/components/vendor-mgmt/vm-shell';
import { buildDashboard, buildRpeReport } from '@/lib/vendor-mgmt/metrics';
import { requireVmSession } from '@/lib/vendor-mgmt/session';
import { vmEntityLabel } from '@/lib/vendor-mgmt/entities';

export default async function VendorManagementDashboardPage() {
  const session = await requireVmSession('view_vendors');
  const [dash, rpe] = await Promise.all([
    buildDashboard(session.filterEntityId),
    buildRpeReport(),
  ]);

  return (
    <VmShell
      title="Vendor Management"
      description="Group Ops spend, licenses, renewals, and people economics — one spine for Tage and every subsidiary."
      active="/shared-services/ops/vendor-management"
      adminRole={session.adminRole}
      primaryAction={
        <Link
          href="/shared-services/ops/vendor-management/vendors/new"
          className="rounded-md bg-[#3a414f] px-3 py-2 text-sm font-medium text-white"
        >
          Add vendor
        </Link>
      }
    >
      <div className="flex flex-wrap gap-8">
        <VmStat
          label="Monthly tech"
          value={money(dash.kpis.monthly_tech)}
          hint="Active vendors · normalized"
        />
        <VmStat
          label="Annualized"
          value={money(dash.kpis.annual_tech)}
          hint={`Waste ${money(dash.kpis.waste_monthly)}/mo`}
        />
        <VmStat
          label="Active HC"
          value={dash.kpis.active_hc}
          hint={session.filterEntityId ? vmEntityLabel(session.filterEntityId) : 'Group'}
        />
        <VmStat
          label="Renewal window"
          value={dash.kpis.in_renewal_window}
          hint={`${dash.kpis.open_renewals} open renewals`}
        />
        <VmStat
          label="Ops signals"
          value={dash.kpis.active_alerts}
          hint={`${dash.kpis.pending_access} access · ${dash.kpis.reclaim_candidates} reclaim`}
        />
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Spend by entity
        </h2>
        <VmTable headers={['Entity', 'Monthly', 'Annual', 'Vendors', 'Waste / mo']}>
          {dash.spend.byEntity.map((e) => (
            <tr key={e.entity_id} className="border-b border-border/70">
              <td className="px-3 py-2.5 font-medium">{e.label}</td>
              <td className="px-3 py-2.5">{money(e.monthly)}</td>
              <td className="px-3 py-2.5">{money(e.annual)}</td>
              <td className="px-3 py-2.5">{e.vendor_count}</td>
              <td className="px-3 py-2.5">{money(e.waste_monthly)}</td>
            </tr>
          ))}
        </VmTable>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            RPE vs CPE
          </h2>
          <VmTable headers={['Entity', 'HC', 'RPE', 'CPE / yr', 'RPE/CPE']}>
            {rpe.entities.map((e) => (
              <tr key={e.entity_id} className="border-b border-border/70">
                <td className="px-3 py-2.5">{e.label}</td>
                <td className="px-3 py-2.5">{e.hc}</td>
                <td className="px-3 py-2.5">{money(e.rpe)}</td>
                <td className="px-3 py-2.5">{money(e.avg_cpe_yr)}</td>
                <td className="px-3 py-2.5">
                  {e.rpe_cpe_ratio ? `${e.rpe_cpe_ratio.toFixed(2)}x` : '—'}
                </td>
              </tr>
            ))}
          </VmTable>
        </section>

        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            Active alerts
          </h2>
          {dash.alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No persisted alert events yet. Run evaluation from Alerts.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {dash.alerts.map((a) => (
                <li
                  key={a.id}
                  className="border-b border-border/60 pb-2"
                >
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {a.severity}
                  </span>{' '}
                  {a.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="text-xs text-muted-foreground">
        Spine v1 · Apply <code>supabase/phase90_vendor_management_spine.sql</code> ·
        Extends Phase 89 partner stack · Docs:{' '}
        <code>docs/VENDOR_MANAGEMENT.md</code>
      </p>
    </VmShell>
  );
}
