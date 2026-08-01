import { VmShell, VmTable } from '@/components/vendor-mgmt/vm-shell';
import { runAlertEvalAction } from '@/app/(app)/shared-services/ops/vendor-management/actions';
import { evaluateAlertRules } from '@/lib/vendor-mgmt/alerts';
import { listAlertEvents, listAlertRules } from '@/lib/vendor-mgmt/repo';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';

export default async function AlertsPage() {
  const session = await requireVmSession('view_vendors');
  const [rules, events, live] = await Promise.all([
    listAlertRules(),
    listAlertEvents(40),
    evaluateAlertRules(),
  ]);
  const canRun = vmCanWrite(session, 'view_audit_log');

  async function runAction() {
    'use server';
    await runAlertEvalAction();
  }

  return (
    <VmShell
      title="Alert rules"
      description="Threshold engine — 90/60/30 renewals, budget, waste, reclaim, coverage gaps."
      active="/shared-services/ops/vendor-management/alerts"
      adminRole={session.adminRole}
      primaryAction={
        canRun ? (
          <form action={runAction}>
            <button type="submit" className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white">
              Evaluate now
            </button>
          </form>
        ) : null
      }
    >
      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">Live evaluation</h2>
        <VmTable headers={['Rule', 'Severity', 'Triggered', 'Message']}>
          {live.length === 0 ? (
            <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No triggers right now.</td></tr>
          ) : live.map((a, i) => (
            <tr key={`${a.rule_id}-${i}`} className="border-b border-border/70">
              <td className="px-3 py-2.5">{a.name}</td>
              <td className="px-3 py-2.5">{a.severity}</td>
              <td className="px-3 py-2.5">{a.triggered ? 'YES' : 'no'}</td>
              <td className="px-3 py-2.5 text-sm">{a.message}</td>
            </tr>
          ))}
        </VmTable>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">Rule catalog</h2>
        <VmTable headers={['ID', 'Name', 'Category', 'Severity', 'Enabled']}>
          {rules.map((r) => (
            <tr key={r.id} className="border-b border-border/70">
              <td className="px-3 py-2 text-xs">{r.id}</td>
              <td className="px-3 py-2">{r.name}</td>
              <td className="px-3 py-2">{r.category}</td>
              <td className="px-3 py-2">{r.severity}</td>
              <td className="px-3 py-2">{r.enabled ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </VmTable>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">Persisted events</h2>
        <VmTable headers={['When', 'Severity', 'Message']}>
          {events.map((e) => (
            <tr key={e.id} className="border-b border-border/70">
              <td className="px-3 py-2 text-xs">{new Date(e.triggered_at).toLocaleString()}</td>
              <td className="px-3 py-2">{e.severity}</td>
              <td className="px-3 py-2">{e.message}</td>
            </tr>
          ))}
        </VmTable>
      </section>
    </VmShell>
  );
}
