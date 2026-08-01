import { VmShell, VmTable } from '@/components/vendor-mgmt/vm-shell';
import { saveAccessRequestAction } from '@/app/(app)/shared-services/ops/vendor-management/actions';
import { listAccessRequests, listEmployees, listProducts } from '@/lib/vendor-mgmt/repo';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';

export default async function AccessPage() {
  const session = await requireVmSession('view_vendors');
  const [requests, employees, products] = await Promise.all([
    listAccessRequests(session.filterEntityId),
    listEmployees(session.filterEntityId),
    listProducts(session.filterEntityId),
  ]);
  const canManage = vmCanWrite(session, 'manage_seats');
  const empName = new Map(employees.map((e) => [e.id, e.name]));
  const prodName = new Map(products.map((p) => [p.id, p.name]));

  async function action(formData: FormData) {
    'use server';
    await saveAccessRequestAction(formData);
  }

  return (
    <VmShell
      title="Access requests"
      description="JIT / non-birthright exceptions — time-boxed grants."
      active="/shared-services/ops/vendor-management/access"
      adminRole={session.adminRole}
    >
      {canManage ? (
        <form action={action} className="grid max-w-3xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
          <label className="text-sm"><span className="text-muted-foreground">Employee</span>
            <select name="emp_id" required className="mt-1 w-full rounded-md border border-border px-2 py-2">
              {employees.filter((e) => e.status === 'Active').map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select></label>
          <label className="text-sm"><span className="text-muted-foreground">Product</span>
            <select name="product_id" required className="mt-1 w-full rounded-md border border-border px-2 py-2">
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
          <label className="text-sm"><span className="text-muted-foreground">Needed until</span>
            <input name="needed_until" type="date" className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <label className="text-sm"><span className="text-muted-foreground">Justification</span>
            <input name="business_justification" className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <button type="submit" className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white sm:w-fit">Submit request</button>
        </form>
      ) : null}

      <VmTable headers={['Employee', 'Product', 'Requested', 'Until', 'Status']}>
        {requests.length === 0 ? (
          <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No access requests.</td></tr>
        ) : requests.map((r) => (
          <tr key={r.id} className="border-b border-border/70">
            <td className="px-3 py-2.5">{empName.get(r.emp_id) ?? r.emp_id}</td>
            <td className="px-3 py-2.5">{prodName.get(r.product_id) ?? r.product_id}</td>
            <td className="px-3 py-2.5">{r.request_date}</td>
            <td className="px-3 py-2.5">{r.needed_until ?? '—'}</td>
            <td className="px-3 py-2.5">{r.status}</td>
          </tr>
        ))}
      </VmTable>
    </VmShell>
  );
}
