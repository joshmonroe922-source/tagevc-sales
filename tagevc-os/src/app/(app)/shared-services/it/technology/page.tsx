import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PARTNER_CATALOG } from '@/lib/partners/catalog';
import { listPartnerRuntimeStatuses } from '@/lib/partners/env';
import {
  listPartnerContracts,
  listPartnerEnablements,
} from '@/lib/partners/repo';
import { requirePermission } from '@/lib/rbac/session';

export default async function TechnologyStackPage() {
  await requirePermission('read:it_assets');

  const runtime = listPartnerRuntimeStatuses();
  const [{ rows: contracts, error: cErr }, { rows: enablements, error: eErr }] =
    await Promise.all([listPartnerContracts(), listPartnerEnablements()]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-muted-foreground">
          <Link href="/shared-services/it/assets" className="hover:underline">
            Technology
          </Link>
          {' · '}
          Partner spine
        </p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Stack · contracts · payments
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Vendors built into the OS spine. Upload contract paths, track payments
          and expirations. New entities inherit enablements via{' '}
          <code className="text-xs">provision_partner_spine_for_entity</code>.
          See <code className="text-xs">docs/PARTNER_SPINE.md</code>.
        </p>
      </div>

      {(cErr || eErr) && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          DB soft-fail (apply phase89 SQL for persistence): {cErr || eErr}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Partner stack</CardTitle>
          <CardDescription>
            Runtime status from env (no secrets shown). Marketing presence is
            managed under{' '}
            <Link
              href="/shared-services/marketing/presence"
              className="underline"
            >
              Marketing → Presence
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Partner</th>
                  <th className="py-2 pr-3 font-medium">Owner</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium">Setup</th>
                </tr>
              </thead>
              <tbody>
                {runtime.map((r) => (
                  <tr
                    key={r.key}
                    id={r.key}
                    className="border-b border-border/60 align-top"
                  >
                    <td className="py-2.5 pr-3">
                      <Link href={r.manageHref} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{r.key}</div>
                    </td>
                    <td className="py-2.5 pr-3">{r.ownerFunction}</td>
                    <td className="py-2.5 pr-3">
                      <Badge
                        variant={
                          r.status === 'live'
                            ? 'default'
                            : r.status === 'configured'
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {r.status}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-muted-foreground">{r.setupNote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contracts & payments</CardTitle>
          <CardDescription>
            Rows from <code className="text-xs">os_partner_contracts</code>.
            Attach storage paths after upload to firm vault.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {contracts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No contracts yet — insert via SQL/admin after phase89. Catalog has{' '}
              {PARTNER_CATALOG.length} partners.
            </p>
          ) : (
            <ul className="space-y-3 text-sm">
              {contracts.map((c) => (
                <li
                  key={c.id}
                  className="rounded-md border border-border/70 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.contract_title}</span>
                    <Badge variant="outline">{c.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {c.vendor_name} · {c.partner_key}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {c.starts_on ?? '—'} → {c.ends_on ?? 'open'}
                    {c.payment_amount != null
                      ? ` · ${c.payment_currency} ${c.payment_amount} / ${c.payment_cadence ?? 'n/a'}`
                      : null}
                    {c.storage_path ? ` · ${c.storage_path}` : ' · no file yet'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entity enablements</CardTitle>
          <CardDescription>
            Sample of <code className="text-xs">os_partner_entity_enablements</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {enablements.length} row(s) loaded
            {enablements.length
              ? ` · e.g. ${enablements
                  .slice(0, 3)
                  .map((e) => `${e.entity_id}/${e.partner_key}`)
                  .join(', ')}`
              : ''}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
