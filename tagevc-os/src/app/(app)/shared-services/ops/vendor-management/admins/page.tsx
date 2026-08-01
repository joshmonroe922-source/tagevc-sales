import { VmShell, VmTable, ENTITY_OPTIONS } from '@/components/vendor-mgmt/vm-shell';
import {
  inviteAdminAction,
  setAdminStatusAction,
} from '@/app/(app)/shared-services/ops/vendor-management/actions';
import { VM_PERMISSION_MATRIX } from '@/lib/vendor-mgmt/permissions';
import { listAdminUsers } from '@/lib/vendor-mgmt/repo';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';
import type { AdminRoleId } from '@/lib/vendor-mgmt/types';

const ROLES = Object.keys(VM_PERMISSION_MATRIX) as AdminRoleId[];

export default async function AdminsPage() {
  const session = await requireVmSession('view_vendors');
  const users = await listAdminUsers();
  const canManage = vmCanWrite(session, 'manage_admins');

  async function inviteAction(formData: FormData) {
    'use server';
    await inviteAdminAction(formData);
  }
  async function statusAction(formData: FormData) {
    'use server';
    await setAdminStatusAction(formData);
  }

  return (
    <VmShell
      title="Portal admins"
      description="Workbook AR-* directory: invite, scope, MFA enrollment flag, activate/deactivate. Login remains SSO-only."
      active="/shared-services/ops/vendor-management/admins"
      adminRole={session.adminRole}
    >
      <p className="text-sm text-muted-foreground">
        Your session: <strong>{session.adminRole}</strong> ({session.email ?? 'dev'}) ·
        Entity filter: {session.filterEntityId ?? 'ALL'}
      </p>

      {canManage ? (
        <form
          action={inviteAction}
          className="grid max-w-4xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-3"
        >
          <h2 className="font-heading text-base font-semibold sm:col-span-3">
            Invite / upsert admin
          </h2>
          <label className="text-sm">
            <span className="text-muted-foreground">Display name</span>
            <input
              name="display_name"
              required
              className="mt-1 w-full rounded-md border border-border px-2 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Email (SSO)</span>
            <input
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded-md border border-border px-2 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Role</span>
            <select
              name="admin_role_id"
              defaultValue="AR-VIEW"
              className="mt-1 w-full rounded-md border border-border px-2 py-2"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Entity scope</span>
            <select
              name="entity_scope"
              defaultValue="ALL"
              className="mt-1 w-full rounded-md border border-border px-2 py-2"
            >
              <option value="ALL">ALL</option>
              {ENTITY_OPTIONS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Emp ID (optional)</span>
            <input
              name="emp_id"
              className="mt-1 w-full rounded-md border border-border px-2 py-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:mt-6">
            <input type="checkbox" name="mfa_enrolled" />
            MFA enrolled (IdP)
          </label>
          <button
            type="submit"
            className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white sm:w-fit"
          >
            Save admin
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          Directory is read-only for your role (manage_admins required to invite).
        </p>
      )}

      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">Directory</h2>
        <VmTable headers={['Name', 'Email', 'Role', 'Scope', 'Status', 'MFA', '']}>
          {users.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                No vm_admin_users rows yet — invite above or CSV import.
              </td>
            </tr>
          ) : (
            users.map((u) => (
              <tr key={u.id} className="border-b border-border/70">
                <td className="px-3 py-2.5">{u.display_name}</td>
                <td className="px-3 py-2.5 text-xs">{u.email}</td>
                <td className="px-3 py-2.5">{u.admin_role_id}</td>
                <td className="px-3 py-2.5 text-xs">{u.entity_scope}</td>
                <td className="px-3 py-2.5">{u.status}</td>
                <td className="px-3 py-2.5">{u.mfa_enrolled ? 'Yes' : 'No'}</td>
                <td className="px-3 py-2.5">
                  {canManage ? (
                    <form action={statusAction} className="inline">
                      <input type="hidden" name="id" value={u.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={u.status === 'Active' ? 'Inactive' : 'Active'}
                      />
                      <button
                        type="submit"
                        className="text-xs underline underline-offset-2"
                      >
                        {u.status === 'Active' ? 'Deactivate' : 'Activate'}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </VmTable>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">Permission matrix</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[800px] text-left text-xs">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-2 py-2">Permission</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-2 py-2">
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                Object.keys(VM_PERMISSION_MATRIX['AR-SUPER']) as Array<
                  keyof (typeof VM_PERMISSION_MATRIX)['AR-SUPER']
                >
              ).map((perm) => (
                <tr key={perm} className="border-b border-border/60">
                  <td className="px-2 py-1.5 font-medium">{perm}</td>
                  {ROLES.map((role) => (
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
