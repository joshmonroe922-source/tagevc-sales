import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money, StatusPill } from '@/components/af/af-ui';
import { getAfStore } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';
import { PayBillButton } from '@/components/af/pay-bill-button';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function BillsPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, qs } = await resolveAfEntityParam(searchParams);
  let bills = getAfStore().bills;
  if (entityId) bills = bills.filter((b) => b.entityCode === entityId);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Accounting · AP"
        title="Bills"
        description="Portal pay posts Dr AP / Cr Cash and closes the bill. Bank feed auto-matches the Payment — no double AP clear."
        secondaryActions={<AfBackLink href={`/shared-services/af/accounting${qs}`} label="Accounting" />}
      />
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Bill</th>
              <th className="px-4 py-3">Vendor</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-right">Pay</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.id} className="border-t border-border/70">
                <td className="px-4 py-3 font-medium">{b.number}</td>
                <td className="px-4 py-3">{b.vendorName}</td>
                <td className="px-4 py-3">{b.entityCode}</td>
                <td className="px-4 py-3">{b.dueDate}</td>
                <td className="px-4 py-3"><StatusPill status={b.status} /></td>
                <td className="px-4 py-3 text-right"><Money value={b.amount} /></td>
                <td className="px-4 py-3 text-right">
                  {b.status !== 'Paid' ? <PayBillButton billId={b.id} /> : <span className="text-xs text-muted-foreground">Paid</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
