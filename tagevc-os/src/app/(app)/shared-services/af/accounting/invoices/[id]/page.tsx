import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money, StatusPill } from '@/components/af/af-ui';
import { assembleInvoiceSendPacket, getAfStore, getEntityAttachmentDefaults } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';
import { PayInvoiceButton } from '@/components/af/pay-invoice-button';
import { notFound } from 'next/navigation';

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ entity?: string }>;
};

export default async function InvoiceDetailPage({ params, searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { id } = await params;
  const { qs } = await resolveAfEntityParam(searchParams);
  const inv = getAfStore().invoices.find((i) => i.id === id);
  if (!inv) notFound();
  const packet = assembleInvoiceSendPacket({
    entityCode: inv.entityCode,
    invoiceNumber: inv.number,
  });
  const defaults = getEntityAttachmentDefaults(inv.entityCode);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="AR · Invoice"
        title={inv.number}
        context={`${inv.customerName} · ${inv.entityCode}`}
        description={`SKU ${inv.sku} · revenue ${inv.revenueAccount} · commission $${inv.commissionAmount.toLocaleString()}`}
        secondaryActions={<AfBackLink href={`/shared-services/af/accounting/invoices${qs}`} label="Invoices" />}
        primaryAction={inv.status !== 'Paid' && inv.status !== 'Draft' ? <PayInvoiceButton invoiceId={inv.id} /> : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border p-4 lg:col-span-2 space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <StatusPill status={inv.status} />
            <span>Issued {inv.issueDate}</span>
            <span>Due {inv.dueDate}</span>
            <span className="font-medium"><Money value={inv.amount} /></span>
            <span className="text-muted-foreground">Paid <Money value={inv.amountPaid} /></span>
          </div>
          <p className="text-sm text-muted-foreground">
            On Paid: deposit Operating 1000 → credit protected commission 2250 → write allocation_ledger by dept → OS callback.
          </p>
        </div>
        <div className="rounded-xl border border-border p-4 space-y-3">
          <h2 className="font-heading font-semibold text-[#3a414f]">Attachments on send</h2>
          <ol className="space-y-2 text-sm">
            {packet.attachments.map((a, i) => (
              <li key={`${a.fileRef}-${i}`} className="flex items-start justify-between gap-2 border-b border-border/40 pb-2">
                <div>
                  <p className="font-medium">{a.displayName}</p>
                  <p className="text-xs text-muted-foreground">{a.source}{a.required ? ' · required' : ''}</p>
                </div>
                <StatusPill status={a.required ? 'Required' : 'Optional'} />
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            Entity defaults: {defaults.map((d) => d.documentType).join(', ')}
          </p>
        </div>
      </div>
    </div>
  );
}
