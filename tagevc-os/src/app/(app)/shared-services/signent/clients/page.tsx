import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/rbac/session';
import {
  listSignentClientOrgs,
  SIGNENT_OPS_MODULES,
  SIGNENT_PORTAL_URL,
} from '@/lib/signent/client-orgs';
import { SignentConvertForm } from '@/components/signent/convert-form';

export default async function SignentClientsPage() {
  await requirePermission('read:shared_services');
  const { rows, error } = await listSignentClientOrgs({ limit: 100 });

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Signent client orgs"
        description={`Sales → purchase → convert → ops at ${SIGNENT_PORTAL_URL}. No fake clients.`}
      />

      <section className="rounded-md border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold">Convert purchase → client</h2>
        <SignentConvertForm />
      </section>

      <section className="rounded-md border border-border">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
          Ops module seams
        </h2>
        <ul className="divide-y divide-border text-sm">
          {SIGNENT_OPS_MODULES.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <div>
                <div className="font-medium">{m.label}</div>
                <div className="text-xs text-muted-foreground">{m.note}</div>
              </div>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {m.status}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {error ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      <section className="rounded-md border border-border">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
          Clients ({rows.length})
        </h2>
        <ul className="divide-y divide-border text-sm">
          {rows.length === 0 ? (
            <li className="px-4 py-6 text-muted-foreground">
              Empty — convert a real purchase when sales closes.
            </li>
          ) : (
            rows.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <Link
                  href={`/shared-services/signent/clients/${r.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {r.legal_name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {r.status} · {r.purchased_product_keys.join(', ') || 'no products'}
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
