import { VmShell, ENTITY_OPTIONS, money } from '@/components/vendor-mgmt/vm-shell';
import {
  saveCompBandAction,
  saveCostCenterAction,
} from '@/app/(app)/shared-services/ops/vendor-management/actions';
import {
  listCompBands,
  listCostCenters,
  listRoles,
} from '@/lib/vendor-mgmt/repo';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';
import { vmEntityLabel } from '@/lib/vendor-mgmt/entities';

export default async function CostCentersPage() {
  const session = await requireVmSession('view_vendors');
  const [centers, bands, roles] = await Promise.all([
    listCostCenters(session.filterEntityId),
    listCompBands(session.filterEntityId),
    listRoles(session.filterEntityId),
  ]);
  const canEdit = vmCanWrite(session, 'edit_contracts');
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  async function ccAction(formData: FormData) {
    'use server';
    await saveCostCenterAction(formData);
  }
  async function bandAction(formData: FormData) {
    'use server';
    await saveCompBandAction(formData);
  }

  return (
    <VmShell
      title="Cost centers & comp bands"
      description="Entity cost centers for chargeback/ownership and role compensation bands for hire economics."
      active="/shared-services/ops/vendor-management/cost-centers"
      adminRole={session.adminRole}
    >
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Cost centers</h2>
        {canEdit ? (
          <form
            action={ccAction}
            className="grid max-w-4xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-4"
          >
            <label className="text-sm sm:col-span-2">
              <span className="text-muted-foreground">Name</span>
              <input
                name="name"
                required
                className="mt-1 w-full rounded-md border border-border px-2 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Entity</span>
              <select
                name="entity_id"
                defaultValue={session.filterEntityId ?? 'ENT-FIRM'}
                className="mt-1 w-full rounded-md border border-border px-2 py-2"
              >
                {ENTITY_OPTIONS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Dept code</span>
              <input
                name="dept_code"
                className="mt-1 w-full rounded-md border border-border px-2 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Type</span>
              <input
                name="cc_type"
                placeholder="G&A / COGS / OpEx"
                className="mt-1 w-full rounded-md border border-border px-2 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Status</span>
              <select
                name="status"
                defaultValue="Active"
                className="mt-1 w-full rounded-md border border-border px-2 py-2"
              >
                <option>Active</option>
                <option>Inactive</option>
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="text-muted-foreground">Notes</span>
              <input
                name="notes"
                className="mt-1 w-full rounded-md border border-border px-2 py-2"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white sm:w-fit"
            >
              Save cost center
            </button>
          </form>
        ) : null}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">Dept</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {centers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-muted-foreground">
                    No cost centers yet.
                  </td>
                </tr>
              ) : (
                centers.map((c) => (
                  <tr key={c.id} className="border-b border-border/70">
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2">{vmEntityLabel(c.entity_id)}</td>
                    <td className="px-3 py-2">{c.dept_code ?? '—'}</td>
                    <td className="px-3 py-2">{c.cc_type ?? '—'}</td>
                    <td className="px-3 py-2">{c.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Comp bands</h2>
        {canEdit && roles.length > 0 ? (
          <form
            action={bandAction}
            className="grid max-w-4xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-4"
          >
            <label className="text-sm sm:col-span-2">
              <span className="text-muted-foreground">Role</span>
              <select
                name="role_id"
                required
                className="mt-1 w-full rounded-md border border-border px-2 py-2"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Entity</span>
              <select
                name="entity_id"
                defaultValue={session.filterEntityId ?? 'ENT-FIRM'}
                className="mt-1 w-full rounded-md border border-border px-2 py-2"
              >
                {ENTITY_OPTIONS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Level</span>
              <input
                name="level"
                placeholder="IC3 / M1"
                className="mt-1 w-full rounded-md border border-border px-2 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Base min</span>
              <input
                name="base_min"
                type="number"
                className="mt-1 w-full rounded-md border border-border px-2 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Base mid</span>
              <input
                name="base_mid"
                type="number"
                className="mt-1 w-full rounded-md border border-border px-2 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Base max</span>
              <input
                name="base_max"
                type="number"
                className="mt-1 w-full rounded-md border border-border px-2 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Comm mid</span>
              <input
                name="comm_target_mid"
                type="number"
                className="mt-1 w-full rounded-md border border-border px-2 py-2"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white sm:w-fit"
            >
              Save comp band
            </button>
          </form>
        ) : canEdit ? (
          <p className="text-sm text-muted-foreground">
            Add roles first, then define compensation bands.
          </p>
        ) : null}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Level</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">Min</th>
                <th className="px-3 py-2">Mid</th>
                <th className="px-3 py-2">Max</th>
              </tr>
            </thead>
            <tbody>
              {bands.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-muted-foreground">
                    No comp bands yet.
                  </td>
                </tr>
              ) : (
                bands.map((b) => (
                  <tr key={b.id} className="border-b border-border/70">
                    <td className="px-3 py-2 font-medium">
                      {roleName.get(b.role_id) ?? b.role_id}
                    </td>
                    <td className="px-3 py-2">{b.level ?? '—'}</td>
                    <td className="px-3 py-2">{vmEntityLabel(b.entity_id)}</td>
                    <td className="px-3 py-2">{money(b.base_min)}</td>
                    <td className="px-3 py-2">{money(b.base_mid)}</td>
                    <td className="px-3 py-2">{money(b.base_max)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </VmShell>
  );
}
