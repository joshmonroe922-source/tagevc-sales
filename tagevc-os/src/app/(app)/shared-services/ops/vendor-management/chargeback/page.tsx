import { VmShell, VmTable, money } from '@/components/vendor-mgmt/vm-shell';
import { saveChargebackAction } from '@/app/(app)/shared-services/ops/vendor-management/actions';
import { buildChargebackAllocations } from '@/lib/vendor-mgmt/metrics';
import { listVendors } from '@/lib/vendor-mgmt/repo';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';

export default async function ChargebackPage() {
  const session = await requireVmSession('view_vendors');
  const [allocs, vendors] = await Promise.all([
    buildChargebackAllocations(),
    listVendors('ENT-FIRM'),
  ]);
  const canEdit = vmCanWrite(session, 'edit_contracts');

  async function action(formData: FormData) {
    'use server';
    await saveChargebackAction(formData);
  }

  return (
    <VmShell
      title="Chargeback"
      description="Allocate TAGE shared platform tech to subsidiaries. Fixed % must sum to 100%."
      active="/shared-services/ops/vendor-management/chargeback"
      adminRole={session.adminRole}
    >
      {canEdit ? (
        <form action={action} className="grid max-w-4xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-3">
          <label className="text-sm sm:col-span-2"><span className="text-muted-foreground">TAGE vendor</span>
            <select name="vendor_id" required className="mt-1 w-full rounded-md border border-border px-2 py-2">
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select></label>
          <label className="text-sm"><span className="text-muted-foreground">Method</span>
            <select name="method" className="mt-1 w-full rounded-md border border-border px-2 py-2">
              <option>Fixed %</option><option>Seats</option>
            </select></label>
          {(['pct_tage','pct_r619','pct_shr','pct_inda'] as const).map((k) => (
            <label key={k} className="text-sm"><span className="text-muted-foreground">{k}</span>
              <input name={k} type="number" step="0.01" defaultValue={0.25} className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          ))}
          <button type="submit" className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white sm:w-fit">Save rule</button>
        </form>
      ) : null}

      <VmTable headers={['Vendor', 'Monthly', 'Valid', 'TAGE', 'R619', 'SHR', 'INDA']}>
        {allocs.length === 0 ? (
          <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No chargeback rules.</td></tr>
        ) : allocs.map((a) => (
          <tr key={a.rule.id} className="border-b border-border/70">
            <td className="px-3 py-2.5">{a.vendor_name}</td>
            <td className="px-3 py-2.5">{money(a.monthly)}</td>
            <td className="px-3 py-2.5 text-xs">{a.valid ? 'OK' : 'SUM≠100%'}</td>
            <td className="px-3 py-2.5">{money(a.alloc.TAGE)}</td>
            <td className="px-3 py-2.5">{money(a.alloc.R619)}</td>
            <td className="px-3 py-2.5">{money(a.alloc.SHR)}</td>
            <td className="px-3 py-2.5">{money(a.alloc.INDA)}</td>
          </tr>
        ))}
      </VmTable>
    </VmShell>
  );
}
