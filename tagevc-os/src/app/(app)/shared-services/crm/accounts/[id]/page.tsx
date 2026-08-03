import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { requirePermission } from '@/lib/rbac/session';
import { listAccountOrgChart } from '@/lib/spine/db/crud';
import {
  actionOrgEdgeDecision,
  actionOrgEdgeDrag,
  actionSuggestHierarchy,
} from '@/app/(app)/shared-services/crm/actions';
import { OrgChartFlow } from '@/components/crm/org-chart-flow';
import { AccountAgentPanel } from '@/components/crm/account-agent-panel';
import { AccountProductLinks } from '@/components/crm/account-product-links';
import { AccountRefreshButton } from '@/components/crm/account-refresh-button';
import { CreateContactForm } from '@/components/crm/create-forms';
import { listAccountProductLinks } from '@/lib/spine/products/graph-links';

type Props = { params: Promise<{ id: string }> };

function freshness(last: string | null, status: string | null): string {
  if (status === 'failed') return 'red';
  if (!last) return 'amber';
  const days =
    (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 30) return 'green';
  if (days < 90) return 'amber';
  return 'red';
}

export default async function CrmAccountPage({ params }: Props) {
  await requirePermission('read:shared_services');
  const { id } = await params;
  const sb = await createPersistClient({ mode: 'service' });
  const { data: account } = await sb
    .from('accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!account) notFound();

  const chart = await listAccountOrgChart(id);
  const products = await listAccountProductLinks(id);
  const { data: people } = await sb
    .from('employments')
    .select('title, contacts(id, full_name, primary_email, title)')
    .eq('account_id', id)
    .eq('is_current', true)
    .limit(100);

  const badge = freshness(
    account.last_enriched_at as string | null,
    account.enrich_status as string | null,
  );

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        eyebrow="CRM"
        title={account.name}
        description={[
          account.canonical_domain,
          account.industry,
          account.enrich_status,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link
          href="/shared-services/crm"
          className="underline underline-offset-2"
        >
          ← CRM
        </Link>
        <span
          className={
            badge === 'green'
              ? 'text-emerald-700'
              : badge === 'amber'
                ? 'text-amber-700'
                : 'text-red-700'
          }
        >
          Freshness: {badge}
          {account.last_enriched_at
            ? ` · ${new Date(String(account.last_enriched_at)).toLocaleDateString()}`
            : ''}
        </span>
        <AccountRefreshButton accountId={id} />
        <Link
          href="/shared-services/crm/suggestions"
          className="underline underline-offset-2"
        >
          Suggestions
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">Overview</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Domain</dt>
            <dd>{account.canonical_domain || '—'}</dd>
            <dt className="text-muted-foreground">Website</dt>
            <dd>{account.website || '—'}</dd>
            <dt className="text-muted-foreground">Employees</dt>
            <dd>{account.employee_count ?? '—'}</dd>
            <dt className="text-muted-foreground">HQ</dt>
            <dd>
              {[account.hq_city, account.hq_state, account.hq_country]
                .filter(Boolean)
                .join(', ') || '—'}
            </dd>
          </dl>
        </section>

        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">Add person</h2>
          <CreateContactForm accountId={id} />
        </section>
      </div>

      <section className="rounded-md border border-border">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
          People ({people?.length ?? 0})
        </h2>
        <ul className="divide-y divide-border text-sm">
          {(people ?? []).length === 0 ? (
            <li className="px-4 py-6 text-muted-foreground">No people yet.</li>
          ) : (
            (people ?? []).map((row, i) => {
              const c = row.contacts as unknown as {
                id: string;
                full_name: string;
                primary_email: string | null;
                title: string | null;
              } | null;
              if (!c) return null;
              return (
                <li key={`${c.id}-${i}`} className="px-4 py-3">
                  <Link
                    href={`/shared-services/crm/contacts/${c.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {c.full_name}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {row.title || c.title || '—'} · {c.primary_email || '—'}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      </section>

      <AccountProductLinks
        accountId={id}
        recruitReqs={products.recruitReqs}
        ndaEnvelopes={products.ndaEnvelopes}
        signentEngagements={products.signentEngagements}
      />

      <AccountAgentPanel accountId={id} />

      <OrgChartFlow
        accountId={id}
        nodes={chart.nodes}
        edges={chart.edges}
        suggestAction={actionSuggestHierarchy}
        edgeAction={actionOrgEdgeDecision}
        dragAction={actionOrgEdgeDrag}
      />
    </div>
  );
}
