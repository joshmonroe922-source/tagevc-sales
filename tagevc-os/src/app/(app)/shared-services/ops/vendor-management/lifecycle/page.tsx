import { VmShell, VmTable } from '@/components/vendor-mgmt/vm-shell';
import { listLifecycleCases, listLifecycleTemplates, listEmployees } from '@/lib/vendor-mgmt/repo';
import { requireVmSession } from '@/lib/vendor-mgmt/session';
import { vmEntityLabel } from '@/lib/vendor-mgmt/entities';

export default async function LifecyclePage() {
  const session = await requireVmSession('view_vendors');
  const [cases, templates, employees] = await Promise.all([
    listLifecycleCases(session.filterEntityId),
    listLifecycleTemplates(),
    listEmployees(session.filterEntityId),
  ]);
  const empName = new Map(employees.map((e) => [e.id, e.name]));

  return (
    <VmShell
      title="Onboard / Offboard"
      description="Runbook templates + active lifecycle cases. Terminate / hire auto-opens cases."
      active="/shared-services/ops/vendor-management/lifecycle"
      adminRole={session.adminRole}
    >
      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">Active cases</h2>
        <VmTable headers={['Case', 'Employee', 'Event', 'Entity', 'Status', 'Start']}>
          {cases.length === 0 ? (
            <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No open lifecycle cases.</td></tr>
          ) : cases.map((c) => (
            <tr key={c.id} className="border-b border-border/70">
              <td className="px-3 py-2.5 text-xs">{c.id}</td>
              <td className="px-3 py-2.5">{empName.get(c.emp_id) ?? c.emp_id}</td>
              <td className="px-3 py-2.5">{c.event}</td>
              <td className="px-3 py-2.5 text-xs">{vmEntityLabel(c.entity_id)}</td>
              <td className="px-3 py-2.5">{c.status}</td>
              <td className="px-3 py-2.5">{c.start_date}</td>
            </tr>
          ))}
        </VmTable>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">Task templates</h2>
        <VmTable headers={['ID', 'Event', 'Phase', 'Task', 'Owner', 'SLA h']}>
          {templates.map((t) => (
            <tr key={t.id} className="border-b border-border/70">
              <td className="px-3 py-2 text-xs">{t.id}</td>
              <td className="px-3 py-2">{t.event}</td>
              <td className="px-3 py-2">{t.phase}</td>
              <td className="px-3 py-2">{t.task}</td>
              <td className="px-3 py-2 text-xs">{t.owner_role}</td>
              <td className="px-3 py-2">{t.sla_hours}</td>
            </tr>
          ))}
        </VmTable>
      </section>
    </VmShell>
  );
}
