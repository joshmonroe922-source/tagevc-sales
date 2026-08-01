import { VmShell, VmTable, money, ENTITY_OPTIONS } from '@/components/vendor-mgmt/vm-shell';
import { saveEmployeeAction, terminateEmployeeAction } from '@/app/(app)/shared-services/ops/vendor-management/actions';
import { listEmployees, listRoles } from '@/lib/vendor-mgmt/repo';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';
import { vmEntityLabel } from '@/lib/vendor-mgmt/entities';

export default async function EmployeesPage() {
  const session = await requireVmSession('view_vendors');
  const [employees, roles] = await Promise.all([
    listEmployees(session.filterEntityId),
    listRoles(session.filterEntityId),
  ]);
  const canManage = vmCanWrite(session, 'manage_employees');
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  async function saveAction(formData: FormData) {
    'use server';
    await saveEmployeeAction(formData);
  }

  return (
    <VmShell
      title="Employees"
      description="Roster drives HC, CPE, birthright licenses. Terminate revokes entitlements + linked portal admin."
      active="/shared-services/ops/vendor-management/employees"
      adminRole={session.adminRole}
    >
      {canManage ? (
        <form action={saveAction} className="grid max-w-4xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-3">
          <label className="text-sm"><span className="text-muted-foreground">Name</span>
            <input name="name" required className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <label className="text-sm"><span className="text-muted-foreground">Entity</span>
            <select name="entity_id" defaultValue={session.filterEntityId ?? 'ENT-R619'} className="mt-1 w-full rounded-md border border-border px-2 py-2">
              {ENTITY_OPTIONS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select></label>
          <label className="text-sm"><span className="text-muted-foreground">Role</span>
            <select name="role_id" className="mt-1 w-full rounded-md border border-border px-2 py-2">
              <option value="">—</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></label>
          <label className="text-sm"><span className="text-muted-foreground">Base salary annual</span>
            <input name="base_salary_annual" type="number" defaultValue={0} className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <label className="text-sm"><span className="text-muted-foreground">Commission target</span>
            <input name="commission_target_annual" type="number" defaultValue={0} className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <label className="text-sm"><span className="text-muted-foreground">FTE</span>
            <input name="fte" type="number" step="0.1" defaultValue={1} className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <button type="submit" className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white sm:w-fit">Add employee</button>
        </form>
      ) : null}

      <VmTable headers={['Name', 'Entity', 'Role', 'Status', 'Base', 'FTE', '']}>
        {employees.length === 0 ? (
          <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No employees yet — sync from HRIS or add manually.</td></tr>
        ) : employees.map((e) => (
          <tr key={e.id} className="border-b border-border/70">
            <td className="px-3 py-2.5 font-medium">{e.name}</td>
            <td className="px-3 py-2.5 text-xs">{vmEntityLabel(e.entity_id)}</td>
            <td className="px-3 py-2.5 text-xs">{e.role_id ? roleName.get(e.role_id) ?? e.role_id : '—'}</td>
            <td className="px-3 py-2.5"><span className="rounded bg-muted px-1.5 py-0.5 text-xs">{e.status}</span></td>
            <td className="px-3 py-2.5">{money(e.base_salary_annual)}</td>
            <td className="px-3 py-2.5">{e.fte}</td>
            <td className="px-3 py-2.5 text-right">
              {canManage && e.status === 'Active' ? (
                <form action={async () => { 'use server'; await terminateEmployeeAction(e.id); }}>
                  <button type="submit" className="text-xs underline">Terminate</button>
                </form>
              ) : null}
            </td>
          </tr>
        ))}
      </VmTable>
    </VmShell>
  );
}
