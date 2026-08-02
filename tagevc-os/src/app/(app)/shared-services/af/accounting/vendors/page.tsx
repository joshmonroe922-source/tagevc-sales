import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money, StatusPill } from '@/components/af/af-ui';
import {
  build1099Register,
  buildVendorPortal,
  buildVmAfVendorLinks,
  evaluateBillApproval,
  getAfStore,
  syncActiveVmVendorsToAp,
  type EntityCode,
} from '@/lib/af';
import { ENTITY_INVOICE_INBOXES } from '@/lib/af/ap/invoice-inbox';
import {
  buildW9RequestEmail,
  currentTaxYear,
} from '@/lib/af/ap/w9-campaign';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { listVendors } from '@/lib/vendor-mgmt/repo';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

const AF_TO_ENT: Record<string, string> = {
  TVC: 'ENT-FIRM',
  R619: 'ENT-R619',
  SHR: 'ENT-SIGNENT',
  INDA: 'ENT-INDA',
};

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

  const vmEntity =
    entityId && AF_TO_ENT[entityId] ? AF_TO_ENT[entityId] : null;
  let vmLinks: ReturnType<typeof buildVmAfVendorLinks> = [];
  let apSync: { created: number; updated: number; errors: string[] } = {
    created: 0,
    updated: 0,
    errors: [],
  };
  try {
    const vmVendors = await listVendors(vmEntity);
    vmLinks = buildVmAfVendorLinks(vmVendors).filter(
      (l) => !entityId || l.entityCode === entityId || l.entityCode === 'MULTI',
    );
    // D05=B — auto-create AP vendors for Active VM rows (fail-soft if SQL missing)
    apSync = await syncActiveVmVendorsToAp(vmVendors);
  } catch {
    vmLinks = [];
  }
  const taxYear = currentTaxYear();
  const w9Missing = vendors.filter((v) => v.taxStatus === 'w9_missing');

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Accounting · AP"
        title="Vendors & 1099"
        description="Vendor portal statuses, W-9 / I-9 gates, approval rules, and 1099 YTD register. Active SaaS rows from Vendor Management appear below for cross-link — tax status stays on this portal."
        secondaryActions={
          <AfBackLink href={`/shared-services/af/accounting${qs}`} label="Accounting" />
        }
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            Vendor Management cross-link
          </h2>
          <Link
            href="/shared-services/ops/vendor-management/vendors"
            className="text-sm underline underline-offset-2"
          >
            Open Vendor Management
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Active VM vendors auto-create AP rows (D05=B) — tax starts W-9
          missing. Sync this load: {apSync.created} created · {apSync.updated}{' '}
          updated
          {apSync.errors.length
            ? ` · ${apSync.errors.length} error(s) (apply phase92 SQL if missing)`
            : ''}
          . See docs/AP_INVOICE_W9_EMAIL.md.
        </p>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Suggested AP id</th>
                <th className="px-4 py-3">VM</th>
              </tr>
            </thead>
            <tbody>
              {vmLinks.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    No active VM vendors in scope — seed Vendor Management or
                    widen entity filter.
                  </td>
                </tr>
              ) : (
                vmLinks.map((l) => (
                  <tr key={l.vmVendorId} className="border-t border-border/70">
                    <td className="px-4 py-3 font-medium">{l.name}</td>
                    <td className="px-4 py-3">{l.entityCode}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {l.category ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">{l.afVendorId}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={l.href}
                        className="text-sm underline underline-offset-2"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Entity invoice inboxes
        </h2>
        <p className="text-sm text-muted-foreground">
          Josh creates these mailboxes / DNS aliases; inbound parse posts to{' '}
          <code className="text-xs">/api/af/ap/inbound-invoice</code>. We do not
          invent credentials.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {ENTITY_INVOICE_INBOXES.filter(
            (i) => !entityId || i.entityCode === entityId,
          ).map((i) => (
            <li
              key={i.entityCode}
              className="rounded-lg border border-border px-4 py-3 text-sm"
            >
              <p className="font-medium">{i.entityCode}</p>
              <p className="font-mono text-xs">{i.suggestedAddress}</p>
              <p className="text-xs text-muted-foreground">{i.parseHint}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          W-9 campaign {taxYear}
        </h2>
        <p className="text-sm text-muted-foreground">
          Outstanding W-9s for the tax year — request / bulk / weekly reminders
          (scaffold). AI year check on receive → exception path for AP.
        </p>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Request email</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {w9Missing.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    No W-9-missing vendors in this portal seed — live list fills
                    from os_af_vendor_w9 after phase92.
                  </td>
                </tr>
              ) : (
                w9Missing.map((v) => {
                  const inbox =
                    ENTITY_INVOICE_INBOXES.find(
                      (i) => i.entityCode === v.entityCode,
                    )?.suggestedAddress ?? 'ap@tagevc.com';
                  const mail = buildW9RequestEmail({
                    vendorName: v.name,
                    taxYear,
                    entityLabel: String(v.entityCode),
                    replyToInbox: inbox,
                  });
                  const mailto = `mailto:${encodeURIComponent(v.email || 'vendor@example.com')}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`;
                  return (
                    <tr key={v.id} className="border-t border-border/70">
                      <td className="px-4 py-3 font-medium">{v.name}</td>
                      <td className="px-4 py-3">{v.entityCode}</td>
                      <td className="px-4 py-3">
                        <a
                          href={mailto}
                          className="text-sm font-medium underline underline-offset-2"
                        >
                          Request W-9 {taxYear}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        outstanding
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

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
