import Link from 'next/link';
import {
  ENTITY_OPTIONS,
  VmShell,
  VmTable,
  money,
} from '@/components/vendor-mgmt/vm-shell';
import { listVendorsComputed } from '@/lib/vendor-mgmt/repo';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';
import { vmEntityLabel } from '@/lib/vendor-mgmt/entities';

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireVmSession('view_vendors');
  const entityFilter =
    session.filterEntityId ||
    (sp.entity && ENTITY_OPTIONS.some((e) => e.id === sp.entity)
      ? sp.entity
      : null);
  const vendors = await listVendorsComputed(entityFilter);
  const canCreate = vmCanWrite(session, 'create_vendor');

  return (
    <VmShell
      title="Vendors"
      description="Current tech stack — seats, cadence, utilization, and renewal stage. Monthly USD is computed server-side."
      active="/shared-services/ops/vendor-management/vendors"
      adminRole={session.adminRole}
      primaryAction={
        canCreate ? (
          <Link
            href="/shared-services/ops/vendor-management/vendors/new"
            className="rounded-md bg-[#3a414f] px-3 py-2 text-sm font-medium text-white"
          >
            Add vendor
          </Link>
        ) : null
      }
    >
      {!session.filterEntityId ? (
        <div className="flex flex-wrap gap-2 text-xs">
          <Link
            href="/shared-services/ops/vendor-management/vendors"
            className={!entityFilter ? 'font-semibold underline' : 'underline'}
          >
            All
          </Link>
          {ENTITY_OPTIONS.map((e) => (
            <Link
              key={e.id}
              href={`/shared-services/ops/vendor-management/vendors?entity=${e.id}`}
              className={
                entityFilter === e.id ? 'font-semibold underline' : 'underline'
              }
            >
              {e.label.split(' · ')[0]}
            </Link>
          ))}
        </div>
      ) : null}

      <VmTable
        headers={[
          'Vendor',
          'Entity',
          'Model',
          'Monthly',
          'Util',
          'Waste',
          'Renewal',
          '',
        ]}
      >
        {vendors.length === 0 ? (
          <tr>
            <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
              No vendors yet. Add live stack data here (workbook samples stripped).
            </td>
          </tr>
        ) : (
          vendors.map((v) => (
            <tr key={v.id} className="border-b border-border/70">
              <td className="px-3 py-2.5">
                <div className="font-medium">{v.name}</div>
                <div className="text-xs text-muted-foreground">
                  {v.category || '—'} · {v.product || '—'}
                </div>
              </td>
              <td className="px-3 py-2.5 text-xs">
                {vmEntityLabel(v.entity_id)}
              </td>
              <td className="px-3 py-2.5 text-xs">
                {v.pricing_model}
                <br />
                {v.billing_cadence}
              </td>
              <td className="px-3 py-2.5">{money(v.monthly_usd)}</td>
              <td className="px-3 py-2.5">
                {v.utilization_pct != null
                  ? `${Math.round(v.utilization_pct * 100)}%`
                  : '—'}
              </td>
              <td className="px-3 py-2.5">{money(v.waste_monthly)}</td>
              <td className="px-3 py-2.5">
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {v.renewal_stage}
                </span>
                {v.days_to_end != null ? (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {v.days_to_end}d
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-2.5 text-right">
                <Link
                  href={`/shared-services/ops/vendor-management/vendors/${v.id}`}
                  className="text-xs underline"
                >
                  Open
                </Link>
              </td>
            </tr>
          ))
        )}
      </VmTable>
    </VmShell>
  );
}
