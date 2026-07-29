import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money, StatusPill } from '@/components/af/af-ui';
import { getAfStore } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';
import { PayInvoiceButton } from '@/components/af/pay-invoice-button';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function InvoicesPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, qs } = await resolveAfEntityParam(searchParams);
  let invoices = getAfStore().invoices;
  if (entityId) invoices = invoices.filter((i) => i.entityCode === entityId);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Accounting · AR"
        title="Invoices"
        description="Send assembles PDF + Wire + I-9 defaults. Paid runs deposit → 2250 commission → waterfall buckets."
        secondaryActions={<AfBackLink href={`/shared-services/af/accounting${qs}`} label="Accounting" />}
      />
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-t border-border/70">
                <td className="px-4 py-3">
                  <Link href={`/shared-services/af/accounting/invoices/${inv.id}${qs}`} className="font-medium text-[#3a414f] underline-offset-2 hover:underline">
                    {inv.number}
                  </Link>
                  <p className="text-xs text-muted-foreground">{inv.sku}</p>
                </td>
                <td className="px-4 py-3">{inv.customerName}</td>
                <td className="px-4 py-3">{inv.entityCode}</td>
                <td className="px-4 py-3"><StatusPill status={inv.status} /></td>
                <td className="px-4 py-3 text-right"><Money value={inv.amount} /></td>
                <td className="px-4 py-3 text-right">
                  {inv.status !== 'Paid' && inv.status !== 'Draft' ? (
                    <PayInvoiceButton invoiceId={inv.id} />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
