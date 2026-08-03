import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/rbac/session';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { ApInboundPollButton } from '@/components/shared-services/ap-inbound-poll-button';

export default async function W9CampaignsPage() {
  await requirePermission('read:shared_services');

  let vendors: Array<{
    id: string;
    name: string;
    email: string | null;
    w9_status: string | null;
    w9_document_id: string | null;
  }> = [];
  let inbound = 0;
  let graphConfigured = Boolean(
    process.env.MS_GRAPH_CLIENT_ID &&
      process.env.MS_GRAPH_CLIENT_SECRET &&
      process.env.MS_GRAPH_TENANT_ID,
  );
  let error: string | null = null;

  try {
    const sb = await createPersistClient();
    const { data, error: vErr } = await sb
      .from('os_af_vendors')
      .select('id, name, email, w9_status, w9_document_id')
      .order('name')
      .limit(100);
    vendors = (data ?? []).map((v) => ({
      id: String(v.id),
      name: String(v.name ?? 'Vendor'),
      email: v.email ? String(v.email) : null,
      w9_status: v.w9_status ? String(v.w9_status) : null,
      w9_document_id: v.w9_document_id ? String(v.w9_document_id) : null,
    }));
    if (vErr) error = vErr.message;
    const { count } = await sb
      .from('os_af_inbound_invoices')
      .select('id', { count: 'exact', head: true });
    inbound = count ?? 0;
  } catch (e) {
    error = e instanceof Error ? e.message : 'AP tables unavailable';
  }

  const missing = vendors.filter(
    (v) => !v.w9_document_id && v.w9_status !== 'received',
  );

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="W-9 / AP inbound"
        description="Campaign view + mailbox poll. Graph secret missing → poll fails closed; W-9 send may use Resend fallback."
      />

      <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded-md border border-border px-4 py-3">
          <div className="text-xs text-muted-foreground">Vendors</div>
          <div className="font-semibold">{vendors.length}</div>
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <div className="text-xs text-muted-foreground">W-9 outstanding</div>
          <div className="font-semibold">{missing.length}</div>
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <div className="text-xs text-muted-foreground">Inbound invoice rows</div>
          <div className="font-semibold">{inbound}</div>
        </div>
      </div>

      <section className="rounded-md border border-border p-4 space-y-2 text-sm">
        <h2 className="font-semibold">Mailbox poll</h2>
        <p className="text-xs text-muted-foreground">
          Graph configured: {graphConfigured ? 'yes' : 'no (fail-closed)'} · Cron
          hits <code>/api/af/ap/poll-inbound</code>
        </p>
        <ApInboundPollButton />
        <Link
          href="/shared-services/af/finance/forecasts"
          className="block text-xs underline underline-offset-2"
        >
          Open forecasting →
        </Link>
      </section>

      {error ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      <section className="rounded-md border border-border">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
          Outstanding W-9 ({missing.length})
        </h2>
        <ul className="divide-y divide-border text-sm">
          {missing.length === 0 ? (
            <li className="px-4 py-6 text-muted-foreground">
              No outstanding W-9 rows (or vendors table empty).
            </li>
          ) : (
            missing.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap justify-between gap-2 px-4 py-3"
              >
                <div>
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {v.email || 'no email'} · {v.w9_status || 'unknown'}
                  </div>
                </div>
                <Link
                  href="/shared-services/af/accounting/vendors"
                  className="text-xs underline underline-offset-2"
                >
                  Request from vendors
                </Link>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
