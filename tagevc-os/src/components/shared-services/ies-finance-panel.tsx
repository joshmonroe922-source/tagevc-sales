'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { mapIesEntityAction } from '@/app/(app)/shared-services/finance/ies-actions';
import { IesSyncControls } from '@/components/ies/ies-sync-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { iesCompanySelectOrder } from '@/lib/ies/company-map';
import { iesConnectHref, iesOpenInBooksHref, IES_EMBED_POLICY } from '@/lib/ies/ux';
import { CompanySelect } from '@/components/shared/company-select';

export function IesFinancePanel({
  report,
  canWrite,
  canRefresh = canWrite,
  entityId,
}: {
  report: IesFinanceReport;
  /** Manage IES OAuth / map (write:shared_services). */
  canWrite: boolean;
  /** Global Refresh — finance readers / P&L roles. */
  canRefresh?: boolean;
  entityId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [mapEntityId, setMapEntityId] = useState(entityId || 'ENT-FIRM');

  const selectedCompany = entityId
    ? report.companies.find((company) => company.entity_id === entityId) ?? null
    : null;
  const lastSyncedAt =
    report.last_sync?.finished_at ??
    report.last_sync?.started_at ??
    selectedCompany?.last_sync_at ??
    null;
  const scopeMetrics = selectedCompany
    ? {
        cash_on_hand: selectedCompany.cash_on_hand,
        ar_balance: selectedCompany.ar_balance,
        ap_balance: selectedCompany.ap_balance,
        open_invoices: selectedCompany.open_invoices,
        overdue_invoices: selectedCompany.overdue_invoices,
        revenue: selectedCompany.revenue,
        expenses: selectedCompany.expenses,
        net_income: selectedCompany.net_income,
      }
    : {
        ...report.consolidated,
        revenue: report.consolidated.revenue,
        expenses: report.consolidated.expenses,
        net_income: report.consolidated.net_income,
      };
  const scopeNotConnected =
    scopeMetrics.revenue == null &&
    scopeMetrics.expenses == null &&
    scopeMetrics.net_income == null &&
    scopeMetrics.cash_on_hand == null;

  return (
    <section className="scroll-mt-20 space-y-4" id="ies-books">
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Intuit Enterprise Suite books
        </h2>
        <p className="text-sm text-muted-foreground">
          IES is the system of record. Tage pulls COA, balances, and invoice
          signals for consolidated and by-company visibility — no autonomous
          write-backs. {IES_EMBED_POLICY}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Connection</CardTitle>
            <CardDescription>
              OAuth to Intuit / QBO Accounting API for IES companies. Refresh
              syncs all connected companies.
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
              <Badge variant={report.sync_enabled ? 'secondary' : 'outline'}>
                Read sync · {report.sync_enabled ? 'enabled' : 'off'}
              </Badge>
              <Badge variant="outline">
                IES writes · {report.write_enabled ? 'gated' : 'off'}
              </Badge>
            </div>
            {!report.configured ? (
              <p className="text-xs text-muted-foreground">
                Set {report.missing_secrets.join(', ') || 'IES_*'} in Vercel.
                Fail-soft until configured.
              </p>
            ) : null}
            <IesSyncControls
              entityId={entityId || null}
              canConnect={canWrite}
              canRefresh={canRefresh}
              showConnect={canWrite && (scopeNotConnected || report.connections.length === 0)}
              showOpenInIes
              lastSyncedAt={lastSyncedAt}
              configured={report.configured}
              syncEnabled={report.sync_enabled}
            />
            {canWrite && !scopeNotConnected && report.connections.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                render={
                  <a
                    href={
                      entityId
                        ? iesConnectHref(entityId)
                        : iesConnectHref(null)
                    }
                  />
                }
              >
                Connect another company
              </Button>
            ) : null}
            {message ? (
              <p className="text-xs text-muted-foreground">{message}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {selectedCompany
                ? `${selectedCompany.company_name} books`
                : 'Consolidated management view'}
            </CardTitle>
            <CardDescription>
              {selectedCompany
                ? `IES snapshot as of ${selectedCompany.as_of ?? 'not synced'}`
                : report.consolidated.note}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {scopeNotConnected ? (
              <div className="mb-3 space-y-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-3">
                <p className="text-sm text-muted-foreground">
                  Not Connected — no live IES snapshot for this scope.
                </p>
                <IesSyncControls
                  entityId={entityId || null}
                  canConnect={canWrite}
                  canRefresh={canRefresh}
                  showConnect={canWrite}
                  showOpenInIes
                  lastSyncedAt={lastSyncedAt}
                  configured={report.configured}
                  syncEnabled={report.sync_enabled}
                  compact
                />
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              {[
                {
                  label: 'Revenue',
                  value: formatFinanceMetric(scopeMetrics.revenue),
                },
                {
                  label: 'Expenses',
                  value: formatFinanceMetric(scopeMetrics.expenses),
                },
                {
                  label: 'Net income',
                  value: formatFinanceMetric(scopeMetrics.net_income),
                },
                {
                  label: 'Cash',
                  value: formatFinanceMetric(scopeMetrics.cash_on_hand),
                },
                {
                  label: 'AR',
                  value: formatFinanceMetric(scopeMetrics.ar_balance),
                },
                {
                  label: 'AP',
                  value: formatFinanceMetric(scopeMetrics.ap_balance),
                },
                {
                  label: 'Open invoices',
                  value:
                    scopeMetrics.open_invoices == null
                      ? '—'
                      : String(scopeMetrics.open_invoices),
                },
                {
                  label: 'Overdue',
                  value:
                    scopeMetrics.overdue_invoices == null
                      ? '—'
                      : String(scopeMetrics.overdue_invoices),
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
                Feed ·{' '}
                {labelFinanceFeedStatus(
                  selectedCompany?.feed_status ?? report.consolidated.feed_status,
                )}
              </Badge>
              {selectedCompany?.stale ? (
                <Badge variant="outline">Stale · refresh needed</Badge>
              ) : null}
              {!selectedCompany && report.consolidated.management_consolidation ? (
                <Badge variant="outline">Management consolidation</Badge>
              ) : null}
              {selectedCompany ? (
                <a
                  href={iesOpenInBooksHref(selectedCompany.entity_id) ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground underline-offset-2 hover:underline"
                >
                  Open in IES
                </a>
              ) : null}
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base">By company</CardTitle>
              <CardDescription>
                Parent and stand-alone operating entities in the shared IES tenant.
                Operating revenue stays in each subsidiary; parent books hold
                capital, SSC, and intercompany activity. Refresh pulls all
                connected companies.
              </CardDescription>
            </div>
            <IesSyncControls
              entityId={entityId || null}
              canConnect={false}
              canRefresh={canRefresh}
              showConnect={false}
              showOpenInIes={false}
              lastSyncedAt={lastSyncedAt}
              configured={report.configured}
              syncEnabled={report.sync_enabled}
              compact
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Cash</TableHead>
                <TableHead>P&amp;L</TableHead>
                <TableHead>AR / AP</TableHead>
                <TableHead>Invoices</TableHead>
                <TableHead>COA</TableHead>
                <TableHead>Feed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.companies.map((c) => {
                const rowDisconnected =
                  c.feed_status === 'missing' ||
                  (c.cash_on_hand == null &&
                    c.revenue == null &&
                    c.net_income == null);
                return (
                  <TableRow key={c.entity_id}>
                    <TableCell>
                      <div className="font-medium">
                        {entityDisplayName({
                          name: c.company_name,
                          entity_id: c.entity_id,
                        })}
                      </div>
                      {c.ies_company_name &&
                      c.ies_company_name !==
                        entityDisplayName({
                          name: c.company_name,
                          entity_id: c.entity_id,
                        }) ? (
                        <div className="text-xs text-muted-foreground">
                          Books · {c.ies_company_name}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatFinanceMetric(c.cash_on_hand)}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">
                      Rev {formatFinanceMetric(c.revenue)} · Net{' '}
                      {formatFinanceMetric(c.net_income)}
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
                      {c.stale ? (
                        <p className="mt-1 text-xs text-amber-800">Stale</p>
                      ) : null}
                      {c.todo ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {c.todo}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {canWrite && rowDisconnected ? (
                          report.configured ? (
                            <Button
                              size="xs"
                              render={
                                <a href={iesConnectHref(c.entity_id)} />
                              }
                            >
                              Connect
                            </Button>
                          ) : (
                            <Button size="xs" disabled>
                              Connect
                            </Button>
                          )
                        ) : null}
                        <a
                          href={iesOpenInBooksHref(c.entity_id) ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium underline-offset-2 hover:underline"
                        >
                          Open in IES
                        </a>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {canWrite ? (
            <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_auto]">
              <CompanySelect
                id="ies-map-company"
                value={mapEntityId}
                onChange={setMapEntityId}
                options={iesCompanySelectOrder().map((row) => ({
                  value: row.entity_id,
                  label: row.display_name,
                }))}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={pending || !mapEntityId}
                onClick={() =>
                  start(async () => {
                    const res = await mapIesEntityAction({
                      entityId: mapEntityId.trim(),
                    });
                    setMessage(
                      res.ok
                        ? `Mapped ${'displayName' in res ? res.displayName : mapEntityId}`
                        : ('error' in res ? res.error : 'Map failed'),
                    );
                    router.refresh();
                  })
                }
              >
                Map company
              </Button>
            </div>
          ) : null}

          {report.connections.length > 0 ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Connected companies</p>
              {report.connections.map((c) => (
                <p key={`${c.display_name}-${c.connected_at ?? c.status}`}>
                  {c.display_name} · {c.status} · {c.environment}
                </p>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
