import { PageHeader } from '@/components/ui/page-header';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { requirePermission } from '@/lib/rbac/session';

export default async function CrmGraphPage() {
  await requirePermission('read:shared_services');

  let accounts: Array<{
    id: string;
    name: string;
    canonical_domain: string | null;
    enrich_status: string | null;
  }> = [];
  let contacts: Array<{
    id: string;
    full_name: string;
    primary_email: string | null;
    title: string | null;
  }> = [];
  let jobsQueued = 0;
  let error: string | null = null;

  try {
    const sb = await createPersistClient();
    const [a, c, j] = await Promise.all([
      sb
        .from('accounts')
        .select('id, name, canonical_domain, enrich_status')
        .order('updated_at', { ascending: false })
        .limit(25),
      sb
        .from('contacts')
        .select('id, full_name, primary_email, title')
        .order('updated_at', { ascending: false })
        .limit(25),
      sb
        .from('enrichment_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'queued'),
    ]);
    accounts = a.data ?? [];
    contacts = c.data ?? [];
    jobsQueued = j.count ?? 0;
    if (a.error || c.error) {
      error = a.error?.message || c.error?.message || null;
    }
  } catch (e) {
    error =
      e instanceof Error
        ? e.message
        : 'Graph tables missing — apply phase94_graph_spine.sql';
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="CRM graph"
        description="Shared accounts / contacts spine (Database Refresh C1–C3). Website intake bootstraps here."
      />
      <p className="text-sm text-muted-foreground">
        Queued enrichment jobs: <strong>{jobsQueued}</strong> · see{' '}
        <code className="text-xs">docs/LEAD_GEN_SPINE.md</code> · worker{' '}
        <code className="text-xs">apps/worker</code>
      </p>
      {error ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-border">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
            Accounts ({accounts.length})
          </h2>
          <ul className="divide-y divide-border text-sm">
            {accounts.length === 0 ? (
              <li className="px-4 py-6 text-muted-foreground">
                No accounts yet — submit a website lead or create via API.
              </li>
            ) : (
              accounts.map((a) => (
                <li key={a.id} className="flex justify-between gap-2 px-4 py-3">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.canonical_domain || '—'} · {a.enrich_status || '—'}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
        <section className="rounded-md border border-border">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
            Contacts ({contacts.length})
          </h2>
          <ul className="divide-y divide-border text-sm">
            {contacts.length === 0 ? (
              <li className="px-4 py-6 text-muted-foreground">
                No contacts yet.
              </li>
            ) : (
              contacts.map((c) => (
                <li key={c.id} className="flex justify-between gap-2 px-4 py-3">
                  <span className="font-medium">{c.full_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.title || '—'} · {c.primary_email || '—'}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
