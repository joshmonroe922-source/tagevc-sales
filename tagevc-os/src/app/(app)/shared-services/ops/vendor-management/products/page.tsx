import { VmShell, VmTable, money, ENTITY_OPTIONS } from '@/components/vendor-mgmt/vm-shell';
import { saveProductAction } from '@/app/(app)/shared-services/ops/vendor-management/actions';
import { listProducts, listVendors } from '@/lib/vendor-mgmt/repo';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';

export default async function ProductsPage() {
  const session = await requireVmSession('view_vendors');
  const [products, vendors] = await Promise.all([
    listProducts(session.filterEntityId),
    listVendors(session.filterEntityId),
  ]);
  const canManage = vmCanWrite(session, 'manage_products');

  async function action(formData: FormData) {
    'use server';
    await saveProductAction(formData);
  }

  return (
    <VmShell
      title="Products & licenses"
      description="Catalog keys for birthright matrix, CPE, and offboard actions."
      active="/shared-services/ops/vendor-management/products"
      adminRole={session.adminRole}
    >
      {canManage ? (
        <form action={action} className="grid max-w-4xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-3">
          <label className="text-sm"><span className="text-muted-foreground">Name</span>
            <input name="name" required className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <label className="text-sm"><span className="text-muted-foreground">Vendor</span>
            <select name="vendor_id" className="mt-1 w-full rounded-md border border-border px-2 py-2">
              <option value="">—</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select></label>
          <label className="text-sm"><span className="text-muted-foreground">Entity scope</span>
            <select name="entity_scope" defaultValue="ALL" className="mt-1 w-full rounded-md border border-border px-2 py-2">
              <option value="ALL">ALL</option>
              {ENTITY_OPTIONS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select></label>
          <label className="text-sm"><span className="text-muted-foreground">Cost / seat / mo</span>
            <input name="cost_seat_mo" type="number" step="0.01" defaultValue={0} className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <label className="text-sm"><span className="text-muted-foreground">Fixed / mo</span>
            <input name="fixed_cost_mo" type="number" step="0.01" defaultValue={0} className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <label className="text-sm"><span className="text-muted-foreground">Offboard</span>
            <select name="offboard_action" className="mt-1 w-full rounded-md border border-border px-2 py-2">
              <option>Revoke</option><option>Keep org</option>
            </select></label>
          <label className="flex items-center gap-2 text-sm pt-6"><input type="checkbox" name="requires_sso" /> Requires SSO</label>
          <button type="submit" className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white sm:w-fit">Add product</button>
        </form>
      ) : null}

      <VmTable headers={['Product', 'Vendor', 'Scope', 'Seat $/mo', 'Fixed $/mo', 'Offboard']}>
        {products.length === 0 ? (
          <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No products yet.</td></tr>
        ) : products.map((p) => (
          <tr key={p.id} className="border-b border-border/70">
            <td className="px-3 py-2.5 font-medium">{p.name}</td>
            <td className="px-3 py-2.5 text-xs">{p.vendor_id ?? '—'}</td>
            <td className="px-3 py-2.5 text-xs">{p.entity_scope}</td>
            <td className="px-3 py-2.5">{money(p.cost_seat_mo, 2)}</td>
            <td className="px-3 py-2.5">{money(p.fixed_cost_mo, 2)}</td>
            <td className="px-3 py-2.5">{p.offboard_action}</td>
          </tr>
        ))}
      </VmTable>
    </VmShell>
  );
}
