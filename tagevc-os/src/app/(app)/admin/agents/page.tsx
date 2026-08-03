import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/rbac/session';
import { SPINE_AGENTS } from '@/lib/spine/agents/catalog';
import { CopilotProbe } from '@/components/crm/copilot-probe';

export default async function SpineAgentsAdminPage() {
  await requirePermission('admin:users');

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Spine agents"
        description="Database Refresh agent UX without Apollo keys. Paid enrich stays fail-closed."
      />

      <section className="rounded-md border border-border">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
          Catalog
        </h2>
        <ul className="divide-y divide-border text-sm">
          {SPINE_AGENTS.map((a) => (
            <li key={a.id} className="px-4 py-3">
              <div className="font-medium">{a.label}</div>
              <div className="text-xs text-muted-foreground">{a.description}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {a.id}
                {a.jobs.length ? ` · jobs ${a.jobs.join(', ')}` : ''}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-md border border-border p-4 space-y-3">
        <h2 className="text-sm font-semibold">Tool-gated copilot probe</h2>
        <p className="text-xs text-muted-foreground">
          Allowlist: list_agents · search · brief. Forbidden: send_email,
          capital DocuSign, paid enrich without LIVE.
        </p>
        <CopilotProbe />
        <Link
          href="/shared-services/crm"
          className="block text-xs underline underline-offset-2"
        >
          Open CRM →
        </Link>
      </section>
    </div>
  );
}
