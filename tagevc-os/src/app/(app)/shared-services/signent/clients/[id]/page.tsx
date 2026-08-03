import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/rbac/session';
import {
  buildSignentOpsScaffold,
  getSignentClientOrg,
  SIGNENT_PORTAL_URL,
} from '@/lib/signent/client-orgs';

type Props = { params: Promise<{ id: string }> };

export default async function SignentClientDetailPage({ params }: Props) {
  await requirePermission('read:shared_services');
  const { id } = await params;
  const { row, error, meta } = await getSignentClientOrg(id);
  if (!row) {
    if (error) {
      return (
        <div className="p-6 text-sm text-amber-800">
          {error} · <Link href="/shared-services/signent/clients">Back</Link>
        </div>
      );
    }
    notFound();
  }

  const modules = buildSignentOpsScaffold(row.id);
  const accountId =
    typeof meta?.account_id === 'string' ? meta.account_id : null;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        eyebrow="Signent"
        title={row.legal_name}
        description={`${row.status} · ${row.purchased_product_keys.join(', ') || 'no products'}`}
      />
      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/shared-services/signent/clients"
          className="underline underline-offset-2"
        >
          ← Clients
        </Link>
        {accountId ? (
          <Link
            href={`/shared-services/crm/accounts/${accountId}`}
            className="underline underline-offset-2"
          >
            CRM account
          </Link>
        ) : null}
        <a
          href={row.portal_url || SIGNENT_PORTAL_URL}
          className="underline underline-offset-2"
          target="_blank"
          rel="noreferrer"
        >
          Open Signent portal
        </a>
      </div>

      <section className="rounded-md border border-border p-4 text-sm">
        <h2 className="mb-2 font-semibold">Client org</h2>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Trade name</dt>
            <dd>{row.trade_name || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Created</dt>
            <dd>{new Date(row.created_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Invoice ref</dt>
            <dd>
              {typeof meta?.invoice_ref === 'string' ? meta.invoice_ref : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Primary contact</dt>
            <dd>
              {typeof meta?.primary_contact_email === 'string'
                ? meta.primary_contact_email
                : '—'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Ops modules (scaffold → portal)</h2>
        {modules.map((m) => (
          <article
            key={m.id}
            className="rounded-md border border-border p-4 text-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium">{m.title}</h3>
              <span className="text-xs uppercase text-muted-foreground">
                {m.status}
              </span>
            </div>
            <p className="mt-1 text-muted-foreground">{m.summary}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
              {m.next.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <a
              href={m.portalHref}
              className="mt-3 inline-block text-xs underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
            >
              Continue in Signent portal →
            </a>
          </article>
        ))}
      </section>
    </div>
  );
}
