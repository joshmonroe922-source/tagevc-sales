import { VmShell, VmTable } from '@/components/vendor-mgmt/vm-shell';
import { listIntegrations } from '@/lib/vendor-mgmt/repo';
import { requireVmSession } from '@/lib/vendor-mgmt/session';
import { PARTNER_CATALOG } from '@/lib/partners/catalog';

export default async function IntegrationsPage() {
  const session = await requireVmSession('view_vendors');
  const rows = await listIntegrations();

  return (
    <VmShell
      title="Integrations"
      description="HRIS / IdP / Finance / SaaS connector registry. No fake credentials — Planned until Josh enables LIVE flags."
      active="/shared-services/ops/vendor-management/integrations"
      adminRole={session.adminRole}
    >
      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">Workbook registry</h2>
        <VmTable headers={['ID', 'System', 'Category', 'Status', 'Auth', 'Notes']}>
          {rows.length === 0 ? (
            <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
              Empty registry — add connectors in DB when ready. Phase 89 partners listed below.
            </td></tr>
          ) : rows.map((r) => (
            <tr key={r.id} className="border-b border-border/70">
              <td className="px-3 py-2 text-xs">{r.id}</td>
              <td className="px-3 py-2">{r.system_name}</td>
              <td className="px-3 py-2">{r.category}</td>
              <td className="px-3 py-2">{r.status}</td>
              <td className="px-3 py-2 text-xs">{r.auth_type ?? '—'}</td>
              <td className="px-3 py-2 text-xs">{r.notes ?? '—'}</td>
            </tr>
          ))}
        </VmTable>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">Phase 89 partner spine</h2>
        <VmTable headers={['Partner', 'Owner', 'Status', 'Summary']}>
          {PARTNER_CATALOG.map((p) => (
            <tr key={p.key} className="border-b border-border/70">
              <td className="px-3 py-2.5 font-medium">{p.label}</td>
              <td className="px-3 py-2.5">{p.ownerSs}</td>
              <td className="px-3 py-2.5">{p.status}</td>
              <td className="px-3 py-2.5 text-sm text-muted-foreground">{p.summary}</td>
            </tr>
          ))}
        </VmTable>
      </section>
    </VmShell>
  );
}
