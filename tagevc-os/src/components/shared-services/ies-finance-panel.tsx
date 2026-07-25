'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  mapIesEntityAction,
  runIesSyncAction,
} from '@/app/(app)/shared-services/finance/ies-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatFinanceMetric } from '@/lib/shared-services/finance-control-plane-phase55';
import { labelFinanceFeedStatus } from '@/lib/shared-services/finance-ops-phase62';
import type { IesFinanceReport } from '@/lib/ies/report';
import { entityDisplayName } from '@/lib/entities/display-name';

export function IesFinancePanel({
  report,
  canWrite,
  entityId,
}: {
  report: IesFinanceReport;
  canWrite: boolean;
  entityId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [mapEntityId, setMapEntityId] = useState(entityId || 'ENT-FIRM');
  const [mapRealmId, setMapRealmId] = useState('');

  const connectHref = entityId
    ? `/api/finance/ies/oauth?entity=${encodeURIComponent(entityId)}`
    : '/api/finance/ies/oauth';

  return (
    <section className="space-y-4" id="ies-books">
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Intuit Enterprise Suite books
        </h2>
        <p className="text-sm text-muted-foreground">
          IES is the system of record. Tage pulls COA, balances, and invoice
          signals for consolidated and by-company visibility — no autonomous
          write-backs.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Connection</CardTitle>
            <CardDescription>
              OAuth to Intuit / QBO Accounting API for IES companies.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={report.configured ? 'secondary' : 'outline'}>
                {report.configured ? 'App credentials set' : 'Credentials missing'}
              </Badge>
              <Badge variant="outline">
                Connections · {report.connections.length}
              </Badge>
            </div>
            {!report.configured ? (
              <p className="text-xs text-muted-foreground">
                Set {report.missing_secrets.join(', ') || 'IES_*'} in Vercel.
                Fail-soft until configured.
              </p>
            ) : null}
            {report.last_sync ? (
              <p className="text-xs text-muted-foreground">
                Last sync · {report.last_sync.status} ·{' '}
                {new Date(report.last_sync.started_at).toLocaleString()}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">No sync runs yet.</p>
            )}
            {canWrite ? (
              <div className="flex flex-wrap gap-2">
                {report.configured ? (
                  <Button size="sm" render={<a href={connectHref} />}>
                    Connect IES company
                  </Button>
                ) : (
                  <Button size="sm" disabled>
                    Connect IES company
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !report.configured}
                  onClick={() =>
                    start(async () => {
                      const res = await runIesSyncAction({
                        entityId: entityId || null,
                      });
                      if ('message' in res) {
                        setMessage(res.message);
                      } else {
                        setMessage(res.error ?? 'Sync failed');
                      }
                      router.refresh();
                    })
                  }
                >
                  Pull latest
                </Button>
              </div>
            ) : null}
            {message ? (
              <p className="text-xs text-muted-foreground">{message}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Consolidated parent view</CardTitle>
            <CardDescription>{report.consolidated.note}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                {
                  label: 'Cash',
                  value: formatFinanceMetric(report.consolidated.cash_on_hand),
                },
                {
                  label: 'AR',
                  value: formatFinanceMetric(report.consolidated.ar_balance),
                },
                {
                  label: 'AP',
                  value: formatFinanceMetric(report.consolidated.ap_balance),
                },
                {
                  label: 'Open invoices',
                  value:
                    report.consolidated.open_invoices == null
                      ? '—'
                      : String(report.consolidated.open_invoices),
                },
                {
                  label: 'Overdue',
                  value:
                    report.consolidated.overdue_invoices == null
                      ? '—'
                      : String(report.consolidated.overdue_invoices),
                },
              ].map((m) => (
                <div
                  key={m.label}
                  className="rounded-md border border-border px-3 py-2"
                >
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    {m.label}
                  </p>
                  <p className="mt-1 font-heading text-xl font-semibold tabular-nums">
                    {m.value}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              <Badge variant="secondary">
                Feed · {labelFinanceFeedStatus(report.consolidated.feed_status)}
              </Badge>
              <Link
                href={report.month_end_checklist_href}
                className="text-muted-foreground underline-offset-2 hover:underline"
              >
                Month-end close surface
              </Link>
              <Link
                href={report.ssc_close_href}
                className="text-muted-foreground underline-offset-2 hover:underline"
              >
                SSC finance checklists
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By company</CardTitle>
          <CardDescription>
            Operating entities in the shared IES environment. Signent reserved
            for later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>IES realm</TableHead>
                <TableHead>Cash</TableHead>
                <TableHead>AR / AP</TableHead>
                <TableHead>Invoices</TableHead>
                <TableHead>COA</TableHead>
                <TableHead>Feed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.companies.map((c) => (
                <TableRow key={c.entity_id}>
                  <TableCell>
                    <div className="font-medium">
                      {entityDisplayName({
                        name: c.company_name,
                        entity_id: c.entity_id,
                      })}
                    </div>
                    {c.ies_company_name ? (
                      <div className="text-xs text-muted-foreground">
                        Books · {c.ies_company_name}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {c.realm_id ?? '—'}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatFinanceMetric(c.cash_on_hand)}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {formatFinanceMetric(c.ar_balance)} /{' '}
                    {formatFinanceMetric(c.ap_balance)}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {c.open_invoices == null
                      ? '—'
                      : `${c.open_invoices} open`}
                    {c.overdue_invoices
                      ? ` · ${c.overdue_invoices} overdue`
                      : ''}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {c.coa_account_count ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {labelFinanceFeedStatus(c.feed_status)}
                    </Badge>
                    {c.todo ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.todo}
                      </p>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {canWrite ? (
            <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                value={mapEntityId}
                onChange={(e) => setMapEntityId(e.target.value)}
                placeholder="ENT-FIRM"
                aria-label="Entity ID"
              />
              <Input
                value={mapRealmId}
                onChange={(e) => setMapRealmId(e.target.value)}
                placeholder="Intuit realmId"
                aria-label="Realm ID"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={pending || !mapEntityId || !mapRealmId}
                onClick={() =>
                  start(async () => {
                    const res = await mapIesEntityAction({
                      entityId: mapEntityId.trim(),
                      realmId: mapRealmId.trim(),
                    });
                    setMessage(
                      res.ok
                        ? `Mapped ${mapEntityId} → ${mapRealmId}`
                        : res.error,
                    );
                    if (res.ok) setMapRealmId('');
                    router.refresh();
                  })
                }
              >
                Map realm
              </Button>
            </div>
          ) : null}

          {report.connections.length > 0 ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Connected realms</p>
              {report.connections.map((c) => (
                <p key={c.realm_id}>
                  {c.company_name || 'Unnamed'} · {c.realm_id} · {c.status} ·{' '}
                  {c.environment}
                </p>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
