import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import { AF_INVOICE_ATTACHMENTS } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function InvoiceAttachmentsSettingsPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, qs } = await resolveAfEntityParam(searchParams);
  const rows = entityId
    ? AF_INVOICE_ATTACHMENTS.filter((a) => a.entityCode === entityId)
    : AF_INVOICE_ATTACHMENTS;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Accounting · Settings"
        title="Invoice attachments"
        description="Every send: Invoice PDF → entity defaults (Wire, I-9) by sort → customer defaults → per-invoice extras."
        secondaryActions={<AfBackLink href={`/shared-services/af/accounting${qs}`} label="Accounting" />}
      />
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Display name</th>
              <th className="px-4 py-3">Required</th>
              <th className="px-4 py-3">Sort</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border/70">
                <td className="px-4 py-3 text-xs">{r.id}</td>
                <td className="px-4 py-3">{r.entityCode}</td>
                <td className="px-4 py-3">{r.documentType}</td>
                <td className="px-4 py-3 font-medium">{r.displayName}</td>
                <td className="px-4 py-3">{r.requiredOnSend ? 'Yes' : 'No'}</td>
                <td className="px-4 py-3">{r.sortOrder}</td>
                <td className="px-4 py-3"><StatusPill status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
