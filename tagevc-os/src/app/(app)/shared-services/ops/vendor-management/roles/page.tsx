import { VmShell, VmTable, ENTITY_OPTIONS } from '@/components/vendor-mgmt/vm-shell';
import { saveRoleAction, setBirthrightAction } from '@/app/(app)/shared-services/ops/vendor-management/actions';
import { listProducts, listRoleProducts, listRoles } from '@/lib/vendor-mgmt/repo';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';

export default async function RolesPage() {
  const session = await requireVmSession('view_vendors');
  const [roles, products, links] = await Promise.all([
    listRoles(session.filterEntityId),
    listProducts(session.filterEntityId),
    listRoleProducts(),
  ]);
  const canManage = vmCanWrite(session, 'manage_role_rules');
  const birth = new Set(links.filter((l) => l.is_birthright).map((l) => `${l.role_id}::${l.product_id}`));

  async function roleAction(formData: FormData) {
    'use server';
    await saveRoleAction(formData);
  }

  return (
    <VmShell
      title="Role → license rules"
      description="Birthright matrix — least privilege. 1 = auto-provision on hire."
      active="/shared-services/ops/vendor-management/roles"
      adminRole={session.adminRole}
    >
      {canManage ? (
        <form action={roleAction} className="grid max-w-3xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-4">
          <label className="text-sm sm:col-span-2"><span className="text-muted-foreground">Role name</span>
            <input name="name" required className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <label className="text-sm"><span className="text-muted-foreground">Entity</span>
            <select name="entity_id" defaultValue={session.filterEntityId ?? 'ENT-FIRM'} className="mt-1 w-full rounded-md border border-border px-2 py-2">
              {ENTITY_OPTIONS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select></label>
          <label className="text-sm"><span className="text-muted-foreground">Level</span>
            <input name="level" className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <button type="submit" className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white sm:w-fit">Add role</button>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-3 py-2">Role</th>
              {products.slice(0, 12).map((p) => (
                <th key={p.id} className="px-2 py-2 text-xs font-medium">{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.length === 0 ? (
              <tr><td colSpan={13} className="px-3 py-6 text-center text-muted-foreground">No roles yet.</td></tr>
            ) : roles.map((r) => (
              <tr key={r.id} className="border-b border-border/70">
                <td className="px-3 py-2 font-medium">{r.name}<div className="text-xs text-muted-foreground">{r.level}</div></td>
                {products.slice(0, 12).map((p) => {
                  const on = birth.has(`${r.id}::${p.id}`);
                  return (
                    <td key={p.id} className="px-2 py-2 text-center">
                      {canManage ? (
                        <form action={async () => { 'use server'; await setBirthrightAction(r.id, p.id, !on); }}>
                          <button type="submit" className={`rounded px-2 py-0.5 text-xs ${on ? 'bg-[#3a414f] text-white' : 'bg-muted'}`}>
                            {on ? '1' : '0'}
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs">{on ? '1' : '0'}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </VmShell>
  );
}
