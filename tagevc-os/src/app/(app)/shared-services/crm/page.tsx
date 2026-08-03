import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { requirePermission } from '@/lib/rbac/session';
import {
  CreateAccountForm,
  CreateContactForm,
} from '@/components/crm/create-forms';
import { getActiveOrgSlug } from '@/lib/spine/auth/active-org-server';
import { resolveOrgIdBySlug } from '@/lib/spine/db/repos';

export default async function CrmGraphPage() {
  await requirePermission('read:shared_services');
  const activeOrg = await getActiveOrgSlug();

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
    const sb = await createPersistClient({ mode: 'service' });
    const orgId = await resolveOrgIdBySlug(activeOrg);
    const [aLinks, cLinks] = orgId
      ? await Promise.all([
          sb
            .from('account_org_links')
            .select('account_id')
            .eq('org_id', orgId)
            .limit(200),
          sb
            .from('contact_org_links')
            .select('contact_id')
            .eq('org_id', orgId)
            .limit(200),
        ])
      : [{ data: [] }, { data: [] }];
    const accountIds = (aLinks.data ?? []).map((r) => String(r.account_id));
    const contactIds = (cLinks.data ?? []).map((r) => String(r.contact_id));

    const [a, c, j] = await Promise.all([
      accountIds.length
        ? sb
            .from('accounts')
            .select('id, name, canonical_domain, enrich_status')
            .in('id', accountIds)
            .order('updated_at', { ascending: false })
            .limit(40)
        : Promise.resolve({ data: [] as typeof accounts, error: null }),
      contactIds.length
        ? sb
            .from('contacts')
            .select('id, full_name, primary_email, title')
            .in('id', contactIds)
            .order('updated_at', { ascending: false })
            .limit(40)
        : Promise.resolve({ data: [] as typeof contacts, error: null }),
      sb
        .from('enrichment_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'queued')
        .eq('org_id', orgId || '00000000-0000-0000-0000-000000000000'),
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
        description={`Shared accounts / contacts (C3–C11) · active org: ${activeOrg}. ⌘K search · hierarchy on account pages.`}
      />
      <p className="text-sm text-muted-foreground">
        Queued jobs: <strong>{jobsQueued}</strong> · Press{' '}
        <kbd className="rounded border border-border px-1.5 py-0.5 text-xs">
          ⌘K
        </kbd>{' '}
        for search ·{' '}
        <Link
          href="/shared-services/crm/suggestions"
          className="underline underline-offset-2"
        >
          Suggestions inbox
        </Link>
      </p>
      {error ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">New account</h2>
          <CreateAccountForm />
        </section>
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">New contact</h2>
          <CreateContactForm />
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-border">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
            Accounts ({accounts.length})
          </h2>
          <ul className="divide-y divide-border text-sm">
            {accounts.length === 0 ? (
              <li className="px-4 py-6 text-muted-foreground">
                No accounts yet.
              </li>
            ) : (
              accounts.map((a) => (
                <li key={a.id} className="flex justify-between gap-2 px-4 py-3">
                  <Link
                    href={`/shared-services/crm/accounts/${a.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {a.name}
                  </Link>
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
                  <Link
                    href={`/shared-services/crm/contacts/${c.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {c.full_name}
                  </Link>
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
