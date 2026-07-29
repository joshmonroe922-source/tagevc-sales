import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money, StatusPill } from '@/components/af/af-ui';
import {
  build1099Register,
  buildVendorPortal,
  evaluateBillApproval,
  getAfStore,
  type EntityCode,
} from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function VendorsPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs, entityId } = await resolveAfEntityParam(searchParams);
  const store = getAfStore();
  const vendors = buildVendorPortal({
    bills: store.bills,
    entityCode: (entityId as EntityCode) || null,
  });
  const form1099 = build1099Register().filter(
    (r) =>
      !entityId ||
      r.entityCode === 'MULTI' ||
      r.entityCode === entityId,
  );
  const approvals = store.bills
    .filter((b) => !entityId || b.entityCode === entityId)
    .filter((b) => b.status !== 'Paid' && b.status !== 'Rejected')
    .map((b) => evaluateBillApproval({ bill: b }));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Accounting · AP"
        title="Vendors & 1099"
        description="Vendor portal statuses, W-9 / I-9 gates, approval rules, and 1099 YTD register."
        secondaryActions={
          <AfBackLink href={`/shared-services/af/accounting${qs}`} label="Accounting" />
        }
      />

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Vendor portal
        </h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Tax</th>
                <th className="px-4 py-3">Open bills</th>
                <th className="px-4 py-3 text-right">Open $</th>
                <th className="px-4 py-3">Pay gate</th>
                <th className="px-4 py-3">Health</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id} className="border-t border-border/70">
                  <td className="px-4 py-3">
                    <p className="font-medium">{v.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {v.id} · {v.entityCode} · {v.status}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {v.taxStatus.replaceAll('_', ' ')}
                    {v.eligible1099 ? ' · 1099' : ''}
                  </td>
                  <td className="px-4 py-3">{v.openBills}</td>
                  <td className="px-4 py-3 text-right">
                    <Money value={v.openAmount} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {v.payBlocked ? v.blockReason : 'Clear to pay'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={v.health} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Approval rules (open bills)
        </h2>
        <ul className="space-y-2">
          {approvals.map((a) => (
            <li
              key={a.billId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm"
            >
              <span>
                <span className="font-medium">{a.billId}</span>
                <span className="ml-2 text-muted-foreground">{a.reason}</span>
              </span>
              <StatusPill
                status={a.autoApprove ? 'Done' : `${a.levelsRequired}-level`}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          1099 register
        </h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3 text-right">YTD paid</th>
                <th className="px-4 py-3">Threshold</th>
                <th className="px-4 py-3">W-9</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {form1099.map((r) => (
                <tr key={r.vendorId} className="border-t border-border/70">
                  <td className="px-4 py-3 font-medium">{r.vendorName}</td>
                  <td className="px-4 py-3 text-right">
                    <Money value={r.ytdPayments} />
                  </td>
                  <td className="px-4 py-3">
                    {r.thresholdMet ? '≥ $600' : 'Below'}
                  </td>
                  <td className="px-4 py-3">
                    {r.w9OnFile ? 'On file' : 'Missing'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
