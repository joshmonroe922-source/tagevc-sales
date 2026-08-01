import { VmShell, VmTable } from '@/components/vendor-mgmt/vm-shell';
import { VM_PERMISSION_MATRIX } from '@/lib/vendor-mgmt/permissions';
import { listAdminUsers } from '@/lib/vendor-mgmt/repo';
import { requireVmSession } from '@/lib/vendor-mgmt/session';

export default async function AdminsPage() {
  const session = await requireVmSession('view_vendors');
  const users = await listAdminUsers();

  return (
    <VmShell
      title="Portal admins"
      description="Workbook admin roles + optional invite directory. OS SSO session maps to AR-* capabilities today."
      active="/shared-services/ops/vendor-management/admins"
      adminRole={session.adminRole}
    >
      <p className="text-sm text-muted-foreground">
        Your session: <strong>{session.adminRole}</strong> ({session.email ?? 'dev'}) ·
        Entity filter: {session.filterEntityId ?? 'ALL'}
      </p>

      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">Directory</h2>
        <VmTable headers={['Name', 'Email', 'Role', 'Scope', 'Status', 'MFA']}>
          {users.length === 0 ? (
            <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
              No vm_admin_users rows yet. Super can invite via SQL/UI later — OS RBAC already gates this portal.
            </td></tr>
          ) : users.map((u) => (
            <tr key={u.id} className="border-b border-border/70">
              <td className="px-3 py-2.5">{u.display_name}</td>
              <td className="px-3 py-2.5 text-xs">{u.email}</td>
              <td className="px-3 py-2.5">{u.admin_role_id}</td>
              <td className="px-3 py-2.5 text-xs">{u.entity_scope}</td>
              <td className="px-3 py-2.5">{u.status}</td>
              <td className="px-3 py-2.5">{u.mfa_enrolled ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </VmTable>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">Permission matrix</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[800px] text-left text-xs">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="px-2 py-2">Permission</th>
                {Object.keys(VM_PERMISSION_MATRIX).map((r) => (
                  <th key={r} className="px-2 py-2">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(VM_PERMISSION_MATRIX['AR-SUPER']) as Array<keyof typeof VM_PERMISSION_MATRIX['AR-SUPER']>).map((perm) => (
                <tr key={perm} className="border-b border-border/60">
                  <td className="px-2 py-1.5 font-medium">{perm}</td>
                  {(Object.keys(VM_PERMISSION_MATRIX) as Array<keyof typeof VM_PERMISSION_MATRIX>).map((role) => (
                    <td key={role} className="px-2 py-1.5 text-center">
                      {VM_PERMISSION_MATRIX[role][perm] ? '1' : '0'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </VmShell>
  );
}
