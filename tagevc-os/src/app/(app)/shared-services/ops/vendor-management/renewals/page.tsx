import {
  VmShell,
  VmTable,
  money,
  ENTITY_OPTIONS,
} from '@/components/vendor-mgmt/vm-shell';
import { saveRenewalAction } from '@/app/(app)/shared-services/ops/vendor-management/actions';
import { daysToEnd, renewalAlertStage } from '@/lib/vendor-mgmt/math';
import { getVmSettings, listRenewals, listVendors } from '@/lib/vendor-mgmt/repo';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';
import { vmEntityLabel } from '@/lib/vendor-mgmt/entities';

export default async function RenewalsPage() {
  const session = await requireVmSession('view_vendors');
  const [renewals, vendors, settings] = await Promise.all([
    listRenewals(session.filterEntityId),
    listVendors(session.filterEntityId),
    getVmSettings(),
  ]);
  const asOf = settings?.as_of_date ?? new Date().toISOString().slice(0, 10);
  const canEdit = vmCanWrite(session, 'edit_contracts');
  const canApprove = vmCanWrite(session, 'approve_renewal');
  const nameById = new Map(vendors.map((v) => [v.id, v.name]));

  async function createAction(formData: FormData) {
    'use server';
    await saveRenewalAction(formData);
  }

  return (
    <VmShell
      title="Renewals"
      description="Contract lifecycle queue — stages from contract end vs as-of date."
      active="/shared-services/ops/vendor-management/renewals"
      adminRole={session.adminRole}
    >
      {canEdit ? (
        <form action={createAction} className="grid max-w-4xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-3">
          <label className="text-sm sm:col-span-1">
            <span className="text-muted-foreground">Vendor</span>
            <select name="vendor_id" required className="mt-1 w-full rounded-md border border-border px-2 py-2">
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Entity</span>
            <select name="entity_id" required defaultValue={session.filterEntityId ?? 'ENT-FIRM'} className="mt-1 w-full rounded-md border border-border px-2 py-2">
              {ENTITY_OPTIONS.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Contract end</span>
            <input name="contract_end" type="date" required className="mt-1 w-full rounded-md border border-border px-2 py-2" />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Proposed annual $</span>
            <input name="proposed_annual" type="number" step="0.01" className="mt-1 w-full rounded-md border border-border px-2 py-2" />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Status</span>
            <select name="status" defaultValue="Watch" className="mt-1 w-full rounded-md border border-border px-2 py-2">
              {['Draft','Watch','In Review','Pending Approval','Pending Finance','Approved','Rejected','At Risk'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {canApprove ? (
            <label className="text-sm">
              <span className="text-muted-foreground">Decision</span>
              <select name="decision" className="mt-1 w-full rounded-md border border-border px-2 py-2">
                <option value="">—</option>
                {['Approve','Reject','Renegotiate'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="submit" className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white sm:col-span-3 sm:w-fit">
            Save renewal
          </button>
        </form>
      ) : null}

      <VmTable headers={['Vendor', 'Entity', 'End', 'Stage', 'Proposed', 'Status', 'Decision']}>
        {renewals.length === 0 ? (
          <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No renewals queued.</td></tr>
        ) : renewals.map((r) => {
          const days = daysToEnd(r.contract_end, asOf);
          return (
            <tr key={r.id} className="border-b border-border/70">
              <td className="px-3 py-2.5">{nameById.get(r.vendor_id) ?? r.vendor_id}</td>
              <td className="px-3 py-2.5 text-xs">{vmEntityLabel(r.entity_id)}</td>
              <td className="px-3 py-2.5">{r.contract_end}</td>
              <td className="px-3 py-2.5"><span className="rounded bg-muted px-1.5 py-0.5 text-xs">{renewalAlertStage(days)}</span></td>
              <td className="px-3 py-2.5">{money(r.proposed_annual)}</td>
              <td className="px-3 py-2.5">{r.status}</td>
              <td className="px-3 py-2.5">{r.decision ?? '—'}</td>
            </tr>
          );
        })}
      </VmTable>
    </VmShell>
  );
}
