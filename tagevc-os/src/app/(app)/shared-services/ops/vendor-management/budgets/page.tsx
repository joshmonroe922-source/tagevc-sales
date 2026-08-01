import { VmShell, VmTable, money, ENTITY_OPTIONS } from '@/components/vendor-mgmt/vm-shell';
import { saveBudgetAction } from '@/app/(app)/shared-services/ops/vendor-management/actions';
import { buildBudgetVsActual } from '@/lib/vendor-mgmt/metrics';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';
import { vmEntityLabel } from '@/lib/vendor-mgmt/entities';

export default async function BudgetsPage() {
  const session = await requireVmSession('view_vendors');
  const rows = await buildBudgetVsActual(session.filterEntityId);
  const canEdit = vmCanWrite(session, 'edit_contracts');

  async function action(formData: FormData) {
    'use server';
    await saveBudgetAction(formData);
  }

  return (
    <VmShell
      title="Budgets vs actual"
      description="Annual budget (input) vs annualized vendor spend (computed)."
      active="/shared-services/ops/vendor-management/budgets"
      adminRole={session.adminRole}
    >
      {canEdit ? (
        <form action={action} className="grid max-w-3xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-4">
          <label className="text-sm"><span className="text-muted-foreground">Entity</span>
            <select name="entity_id" defaultValue={session.filterEntityId ?? 'ENT-FIRM'} className="mt-1 w-full rounded-md border border-border px-2 py-2">
              {ENTITY_OPTIONS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select></label>
          <label className="text-sm"><span className="text-muted-foreground">Category</span>
            <input name="category" required className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <label className="text-sm"><span className="text-muted-foreground">FY</span>
            <input name="fy" type="number" defaultValue={new Date().getFullYear()} className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <label className="text-sm"><span className="text-muted-foreground">Annual budget</span>
            <input name="annual_budget" type="number" required className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <button type="submit" className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white sm:w-fit">Save budget</button>
        </form>
      ) : null}

      <VmTable headers={['Entity', 'Category', 'FY', 'Budget', 'Actual', 'Variance', '']}>
        {rows.length === 0 ? (
          <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No budgets configured.</td></tr>
        ) : rows.map((b) => (
          <tr key={b.id} className="border-b border-border/70">
            <td className="px-3 py-2.5 text-xs">{vmEntityLabel(b.entity_id)}</td>
            <td className="px-3 py-2.5">{b.category}</td>
            <td className="px-3 py-2.5">{b.fy}</td>
            <td className="px-3 py-2.5">{money(b.annual_budget)}</td>
            <td className="px-3 py-2.5">{money(b.actual_annual)}</td>
            <td className="px-3 py-2.5">{money(b.variance)}</td>
            <td className="px-3 py-2.5 text-xs">{b.over_budget ? 'Over' : 'OK'}</td>
          </tr>
        ))}
      </VmTable>
    </VmShell>
  );
}
