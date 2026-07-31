import Link from 'next/link';
import { SscFunctionHomeChromeServer } from '@/components/shared-services/ssc-function-home-chrome-server';
import { getTechnologyStackView, listVendorPayments } from '@/lib/partners/repo';
import { missingEnvForPartner, resolvePartnerStatus } from '@/lib/partners/registry';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';

export default async function TechnologyStackPage() {
  await requirePermission('read:it_assets');
  const ctx = await getSessionContext();
  const firmWide = ctx
    ? isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)
    : false;
  const entityId = firmWide ? null : (ctx?.profile.entity_id ?? null);

  const stack = await getTechnologyStackView(entityId);
  const payments = await listVendorPayments(null);

  return (
    <div className="space-y-6">
      <SscFunctionHomeChromeServer
        functionKey="it"
        entityId={entityId}
        firmWide={firmWide}
      />

      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Technology stack
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Partner platforms on the OS spine — contracts, payments, expirations,
          and connection posture. New entities inherit these bindings.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/shared-services/it/assets"
          className="underline underline-offset-2"
        >
          ← Assets / Intune
        </Link>
        <Link href="/shared-services/bi" className="underline underline-offset-2">
          Partner BI
        </Link>
        <Link
          href="/shared-services/marketing/presence"
          className="underline underline-offset-2"
        >
          Marketing presence
        </Link>
        <span className="text-muted-foreground">
          Docs: <code>docs/PARTNER_SPINE.md</code>
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-3 py-2 font-medium">Partner</th>
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Contracts</th>
              <th className="px-3 py-2 font-medium">Next expiry</th>
              <th className="px-3 py-2 font-medium">Missing env</th>
            </tr>
          </thead>
          <tbody>
            {stack.map(({ def, binding, contracts, nextExpiration }) => {
              const status = resolvePartnerStatus(def, binding?.status);
              const missing = missingEnvForPartner(def.key).filter(
                (k) => !k.endsWith('_LIVE'),
              );
              return (
                <tr
                  key={def.key}
                  id={def.key}
                  className="border-b border-border/70 align-top"
                >
                  <td className="px-3 py-3">
                    <div className="font-medium">{def.label}</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {def.summary}
                    </p>
                  </td>
                  <td className="px-3 py-3">{def.ownerSs}</td>
                  <td className="px-3 py-3">
                    <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                      {status}
                    </span>
                    {binding?.external_account_id ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        ext: {binding.external_account_id}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    {contracts.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <ul className="space-y-1">
                        {contracts.map((c) => (
                          <li key={c.id}>
                            <span className="font-medium">
                              {c.contract_title}
                            </span>
                            <span className="text-muted-foreground">
                              {' '}
                              ({c.status})
                            </span>
                            {c.document_path ? (
                              <div className="text-xs text-muted-foreground">
                                {c.document_path}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-3">{nextExpiration ?? '—'}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {missing.length === 0
                      ? 'ready / optional'
                      : missing.slice(0, 4).join(', ') +
                        (missing.length > 4 ? '…' : '')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section>
        <h2 className="text-base font-semibold">Recent vendor payments</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Contract document paths and payments feed Technology + Finance ops.
          Apply <code>phase89_partner_spine.sql</code> first.
        </p>
        {payments.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No payments recorded yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {payments.slice(0, 20).map((p) => (
              <li
                key={p.id}
                className="rounded-md border border-border px-3 py-2"
              >
                {p.paid_on} · {(p.amount_cents / 100).toFixed(2)} {p.currency}
                {p.reference ? ` · ${p.reference}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
