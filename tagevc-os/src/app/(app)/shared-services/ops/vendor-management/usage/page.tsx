import { VmShell, VmTable } from '@/components/vendor-mgmt/vm-shell';
import { daysToEnd } from '@/lib/vendor-mgmt/math';
import { getVmSettings, listEmployees, listProducts, listUsageSignals } from '@/lib/vendor-mgmt/repo';
import { requireVmSession } from '@/lib/vendor-mgmt/session';

export default async function UsagePage() {
  const session = await requireVmSession('view_vendors');
  const [signals, employees, products, settings] = await Promise.all([
    listUsageSignals(),
    listEmployees(session.filterEntityId),
    listProducts(),
    getVmSettings(),
  ]);
  const asOf = settings?.as_of_date ?? new Date().toISOString().slice(0, 10);
  const empName = new Map(employees.map((e) => [e.id, e.name]));
  const prodName = new Map(products.map((p) => [p.id, p.name]));
  const empIds = new Set(employees.map((e) => e.id));
  const rows = signals
    .filter((s) => !session.filterEntityId || empIds.has(s.emp_id))
    .map((s) => {
      const daysInactive = s.last_active
        ? Math.max(0, -(daysToEnd(s.last_active, asOf) ?? 0))
        : null;
      const reclaim =
        s.assigned &&
        daysInactive != null &&
        daysInactive >= s.threshold_days;
      return { ...s, daysInactive, reclaim };
    });

  return (
    <VmShell
      title="Usage & reclaim"
      description="Last-active signals → reclaim candidates. Feed from SaaS APIs when integrations go Live."
      active="/shared-services/ops/vendor-management/usage"
      adminRole={session.adminRole}
    >
      <VmTable headers={['Employee', 'Product', 'Assigned', 'Last active', 'Days inactive', 'Status']}>
        {rows.length === 0 ? (
          <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No usage signals yet.</td></tr>
        ) : rows.map((r) => (
          <tr key={r.id} className="border-b border-border/70">
            <td className="px-3 py-2.5">{empName.get(r.emp_id) ?? r.emp_id}</td>
            <td className="px-3 py-2.5">{prodName.get(r.product_id) ?? r.product_id}</td>
            <td className="px-3 py-2.5">{r.assigned ? 'Yes' : 'No'}</td>
            <td className="px-3 py-2.5">{r.last_active ?? '—'}</td>
            <td className="px-3 py-2.5">{r.daysInactive ?? '—'}</td>
            <td className="px-3 py-2.5">{r.reclaim ? 'RECLAIM CANDIDATE' : 'OK'}</td>
          </tr>
        ))}
      </VmTable>
    </VmShell>
  );
}
