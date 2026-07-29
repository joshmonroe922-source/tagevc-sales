import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import { AttachmentUploadForm } from '@/components/af/attachment-upload-form';
import {
  AF_INVOICE_ATTACHMENTS,
  listAfAttachments,
} from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function InvoiceAttachmentsSettingsPage({
  searchParams,
}: Props) {
  await requirePermission('read:shared_services');
  const { entityId, qs } = await resolveAfEntityParam(searchParams);
  const rows = entityId
    ? AF_INVOICE_ATTACHMENTS.filter((a) => a.entityCode === entityId)
    : AF_INVOICE_ATTACHMENTS;
  const uploads = await listAfAttachments(entityId);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Accounting · Settings"
        title="Invoice attachments"
        description="Every send: Invoice PDF → entity defaults (Wire, I-9) by sort → customer defaults → per-invoice extras. Upload go-live PDFs for ENT-06."
        secondaryActions={
          <AfBackLink
            href={`/shared-services/af/accounting${qs}`}
            label="Accounting"
          />
        }
      />
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Display name</th>
              <th className="px-4 py-3">Required</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Upload</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border/70">
                <td className="px-4 py-3">{r.entityCode}</td>
                <td className="px-4 py-3">{r.documentType}</td>
                <td className="px-4 py-3 font-medium">{r.displayName}</td>
                <td className="px-4 py-3">{r.requiredOnSend ? 'Yes' : 'No'}</td>
                <td className="px-4 py-3">
                  <StatusPill status={r.status} />
                </td>
                <td className="px-4 py-3">
                  <AttachmentUploadForm
                    entityCode={r.entityCode}
                    documentType={r.documentType}
                    displayName={r.displayName}
                    attachmentDefaultId={r.id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Uploaded files
        </h2>
        {uploads.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No PDFs uploaded yet — use the upload controls above for Wiring / I-9.
          </p>
        ) : (
          <ul className="space-y-2">
            {uploads.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-[#3a414f]">{u.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {u.entityCode} · {u.documentType} · {u.fileName}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {(u.byteSize / 1024).toFixed(1)} KB ·{' '}
                  {new Date(u.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
