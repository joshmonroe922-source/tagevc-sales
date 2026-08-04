import { VmShell, VmTable } from '@/components/vendor-mgmt/vm-shell';
import { entityLabelOrFirm } from '@/lib/entities/display-name';
import { listAuditEvents } from '@/lib/vendor-mgmt/repo';
import { requireVmSession } from '@/lib/vendor-mgmt/session';

export default async function AuditPage() {
  const session = await requireVmSession('view_audit_log');
  const events = await listAuditEvents(150);

  return (
    <VmShell
      title="Audit log"
      description="Append-only trail — vendor, contract, license, admin mutations."
      active="/shared-services/ops/vendor-management/audit"
      adminRole={session.adminRole}
    >
      <VmTable headers={['When', 'Actor', 'Action', 'Object', 'Entity']}>
        {events.length === 0 ? (
          <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No audit events yet.</td></tr>
        ) : events.map((e) => (
          <tr key={e.id} className="border-b border-border/70">
            <td className="px-3 py-2 text-xs whitespace-nowrap">{new Date(e.ts_utc).toLocaleString()}</td>
            <td className="px-3 py-2 text-xs">{e.actor_email ?? '—'}</td>
            <td className="px-3 py-2">{e.action}</td>
            <td className="px-3 py-2 text-xs">{e.object_type} {e.object_id}</td>
            <td
              className="px-3 py-2 text-xs"
              title={e.entity_id ?? undefined}
            >
              {entityLabelOrFirm(e.entity_id, '—')}
            </td>
          </tr>
        ))}
      </VmTable>
    </VmShell>
  );
}
