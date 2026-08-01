import { VmShell, VmTable } from '@/components/vendor-mgmt/vm-shell';
import { seedIntegrationsAction } from '@/app/(app)/shared-services/ops/vendor-management/actions';
import { PARTNER_CATALOG } from '@/lib/partners/catalog';
import {
  VM_CONNECTOR_SCAFFOLDS,
  connectorEnvReady,
} from '@/lib/vendor-mgmt/connectors';
import { listIntegrations } from '@/lib/vendor-mgmt/repo';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';

export default async function IntegrationsPage() {
  const session = await requireVmSession('view_vendors');
  const rows = await listIntegrations();
  const canSeed = vmCanWrite(session, 'manage_admins');

  async function seedAction() {
    'use server';
    await seedIntegrationsAction();
  }

  return (
    <VmShell
      title="Integrations"
      description="HRIS / IdP / Finance / SaaS connector registry. No fake credentials — Planned until Josh enables LIVE flags."
      active="/shared-services/ops/vendor-management/integrations"
      adminRole={session.adminRole}
    >
      {canSeed ? (
        <form action={seedAction}>
          <button
            type="submit"
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            Seed workbook connector scaffolds into DB
          </button>
        </form>
      ) : null}

      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">Registry (DB)</h2>
        <VmTable headers={['ID', 'System', 'Category', 'Status', 'Auth', 'Notes']}>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                Empty registry — seed scaffolds above when ready.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="border-b border-border/70">
                <td className="px-3 py-2 text-xs">{r.id}</td>
                <td className="px-3 py-2">{r.system_name}</td>
                <td className="px-3 py-2">{r.category}</td>
                <td className="px-3 py-2">{r.status}</td>
                <td className="px-3 py-2 text-xs">{r.auth_type ?? '—'}</td>
                <td className="px-3 py-2 text-xs">{r.notes ?? '—'}</td>
              </tr>
            ))
          )}
        </VmTable>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">
          Connector scaffolds (code)
        </h2>
        <VmTable headers={['System', 'Category', 'LIVE ready', 'Missing env', 'Notes']}>
          {VM_CONNECTOR_SCAFFOLDS.map((c) => {
            const { live, missing } = connectorEnvReady(c);
            return (
              <tr key={c.id} className="border-b border-border/70">
                <td className="px-3 py-2.5 font-medium">{c.system_name}</td>
                <td className="px-3 py-2.5">{c.category}</td>
                <td className="px-3 py-2.5">{live ? 'LIVE=1' : 'dry-run'}</td>
                <td className="px-3 py-2.5 text-xs">
                  {missing.length ? missing.slice(0, 3).join(', ') : '—'}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {c.notes}
                </td>
              </tr>
            );
          })}
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
              <td className="px-3 py-2.5 text-sm text-muted-foreground">
                {p.summary}
              </td>
            </tr>
          ))}
        </VmTable>
      </section>
    </VmShell>
  );
}
