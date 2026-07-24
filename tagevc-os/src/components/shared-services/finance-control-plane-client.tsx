'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  approveFinanceWritebackPhase55Action,
  proposeFinanceWritebackPhase55Action,
  recordFinanceCloseChecklistPhase55Action,
  refreshFinanceControlPlanePhase55Action,
} from '@/app/(app)/shared-services/finance/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  closeStatusLabel,
  formatFinanceMetric,
  type FinanceControlPlanePhase55Report,
} from '@/lib/shared-services/finance-control-plane-phase55';
import {
  FINANCE_REQUEST_TEMPLATES,
  IES_BOUNDARY,
  companyFinanceHref,
  enrichSubsidiaryLabels,
  financeTicketHref,
  labelFinanceFeedStatus,
  splitCloseChecklists,
  type PortfolioBridgeMetric,
} from '@/lib/shared-services/finance-ops-phase62';
import { entityDisplayName } from '@/lib/entities/display-name';
import { CompanySelect } from '@/components/shared/company-select';
import { formatRunway, formatUsdK } from '@/lib/format';

export function FinanceControlPlaneClient({
  report: initialReport,
  canWrite,
  initialEntityId = '',
  portfolioBridge = [],
}: {
  report: FinanceControlPlanePhase55Report;
  canWrite: boolean;
  initialEntityId?: string;
  portfolioBridge?: PortfolioBridgeMetric[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [report, setReport] = useState(() =>
    enrichSubsidiaryLabels(initialReport),
  );
  const [entityId, setEntityId] = useState(initialEntityId);
  const [message, setMessage] = useState<string | null>(null);
  const [wbSummary, setWbSummary] = useState('');
  const [wbKind, setWbKind] = useState<
    | 'ies_journal_adjustment'
    | 'ies_vendor_bill_note'
    | 'ies_ar_memo'
    | 'ies_close_flag'
    | 'ies_other_observe'
  >('ies_journal_adjustment');

  const { month_end: monthEndItems, year_end: yearEndItems } =
    splitCloseChecklists(report.checklist);

  function applyReport(next: FinanceControlPlanePhase55Report) {
    setReport(enrichSubsidiaryLabels(next));
  }

  function runRefresh() {
    start(async () => {
      setMessage(null);
      const result = await refreshFinanceControlPlanePhase55Action(
        entityId.trim() || null,
      );
      if (!result.ok) {
        setMessage(result.error);
        applyReport(result.report);
        return;
      }
      applyReport(result.report);
      setMessage('Finance board refreshed (IES observe-only).');
      router.refresh();
    });
  }

  function markChecklist(
    closeKind: 'month_end' | 'year_end',
    periodKey: string,
    itemKey: string,
    itemLabel: string,
    status: 'done' | 'in_progress' | 'blocked',
  ) {
    start(async () => {
      setMessage(null);
      const result = await recordFinanceCloseChecklistPhase55Action({
        entityId: entityId.trim() || null,
        closeKind,
        periodKey,
        itemKey,
        itemLabel,
        status,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      applyReport(result.report);
      setMessage(`Checklist ${itemKey} → ${status}`);
      router.refresh();
    });
  }

  function proposeWriteback() {
    const summary = wbSummary.trim();
    if (summary.length < 2) {
      setMessage('Write-back summary required.');
      return;
    }
    start(async () => {
      setMessage(null);
      const result = await proposeFinanceWritebackPhase55Action({
        entityId: entityId.trim() || null,
        actionKind: wbKind,
        summary,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setWbSummary('');
      applyReport(result.report);
      setMessage(
        'Write-back proposed — dual human approval required; IES not written.',
      );
      router.refresh();
    });
  }

  function decideWriteback(
    proposalId: string,
    decision: 'approve' | 'reject',
  ) {
    const ok = window.confirm(
      decision === 'approve'
        ? 'Approve this IES write-back proposal? A second distinct human approver is required. Tage never writes to IES and never auto-approves money.'
        : 'Reject this IES write-back proposal?',
    );
    if (!ok) return;
    start(async () => {
      setMessage(null);
      const result = await approveFinanceWritebackPhase55Action({
        proposalId,
        decision,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      applyReport(result.report);
      setMessage(
        decision === 'approve'
          ? 'Approval recorded (dual-approve gate; operator executes in IES).'
          : 'Proposal rejected.',
      );
      router.refresh();
    });
  }

  const kpis = [
    { label: 'Cash on hand', value: formatFinanceMetric(report.cash_on_hand) },
    { label: 'AR balance', value: formatFinanceMetric(report.ar_balance) },
    { label: 'AP balance', value: formatFinanceMetric(report.ap_balance) },
    {
      label: 'Monthly burn',
      value: formatFinanceMetric(report.burn_rate_monthly),
    },
    {
      label: 'Close %',
      value:
        report.close_pct_complete == null
          ? '—'
          : `${report.close_pct_complete}%`,
    },
    {
      label: 'Open anomalies',
      value: String(report.open_anomaly_count),
    },
  ];

  function defaultPeriodKey(closeKind: 'month_end' | 'year_end'): string {
    const now = new Date();
    return closeKind === 'year_end'
      ? String(now.getFullYear())
      : now.toISOString().slice(0, 7);
  }

  function renderChecklist(
    title: string,
    closeKind: 'month_end' | 'year_end',
    items: FinanceControlPlanePhase55Report['checklist'],
    emptyDescription: string,
  ) {
    return (
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">
            Append-only orchestration evidence. Completing an item here does not
            post to IES.
          </p>
        </div>
        {items.length === 0 ? (
          <EmptyState title="No close items yet" description={emptyDescription} />
        ) : (
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={`${item.item_key}-${item.status}-${item.period_key}`}>
                      <TableCell>
                        <div className="font-medium">{item.item_label}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.item_key}
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {item.period_key}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {closeStatusLabel(item.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canWrite ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() =>
                                markChecklist(
                                  closeKind,
                                  item.period_key || defaultPeriodKey(closeKind),
                                  item.item_key,
                                  item.item_label,
                                  'in_progress',
                                )
                              }
                            >
                              Start
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                markChecklist(
                                  closeKind,
                                  item.period_key || defaultPeriodKey(closeKind),
                                  item.item_key,
                                  item.item_label,
                                  'done',
                                )
                              }
                            >
                              Done
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Read-only
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            Feed · {labelFinanceFeedStatus(report.feed_status)}
          </Badge>
          <Badge variant="outline">Books system of record</Badge>
          <Badge variant="outline">Money never auto-approved</Badge>
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Finance & Accounting
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Orchestrate close checklists, anomaly visibility, and dual-approve
          IES write-back proposals. Intuit Enterprise Suite remains the system
          of record — Tage observes and gates; it never silently writes money
          movements.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            Company filter
            <CompanySelect
              allowAll
              allLabel="All companies"
              value={entityId}
              onChange={setEntityId}
              className="block w-44"
            />
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !canWrite}
            onClick={runRefresh}
          >
            Refresh board
          </Button>
          <Link
            href="/shared-services?service=Finance#inbox"
            className="inline-flex h-7 items-center rounded-lg px-2.5 text-[0.8rem] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Finance inbox
          </Link>
        </div>
        {message ? (
          <p className="text-sm text-muted-foreground">{message}</p>
        ) : null}
        {report.todo ? (
          <p className="text-xs text-muted-foreground">TODO · {report.todo}</p>
        ) : null}
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="pb-2">
              <CardDescription>{kpi.label}</CardDescription>
              <CardTitle className="font-heading text-2xl tabular-nums">
                {kpi.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            Books system boundary
          </h2>
          <p className="text-sm text-muted-foreground">
            {IES_BOUNDARY.systemOfRecord} · Tage role: {IES_BOUNDARY.tageRole}
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Read-only today</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                {IES_BOUNDARY.readOnlyToday.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Controlled write-back</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                {IES_BOUNDARY.controlledWritebackFuture.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Never automated</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                {IES_BOUNDARY.neverAutomated.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {renderChecklist(
        'Month-end close',
        'month_end',
        monthEndItems,
        'No month-end close items yet. Refresh the board to seed stubs, or wait for the books feed.',
      )}

      {renderChecklist(
        'Year-end close',
        'year_end',
        yearEndItems,
        'No year-end close items yet. They appear when year-end orchestration is seeded.',
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Anomaly alerts</CardTitle>
            <CardDescription>
              Visibility only — never auto-approves money.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {report.anomalies.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No anomalies recorded.
              </p>
            ) : (
              report.anomalies.slice(0, 12).map((a) => (
                <div
                  key={`${a.anomaly_id ?? a.title}-${a.created_at}`}
                  className="rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        a.severity === 'critical' ? 'destructive' : 'secondary'
                      }
                    >
                      {a.severity}
                    </Badge>
                    <span className="font-medium">{a.title}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.anomaly_kind}
                    {a.entity_id
                      ? ` · ${entityDisplayName(a.entity_id)}`
                      : ''}
                  </p>
                  <Link
                    href={financeTicketHref(
                      'fin_anomaly_review',
                      a.entity_id ?? (entityId.trim() || null),
                    )}
                    className="mt-1 inline-block text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Create review ticket
                  </Link>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Company financial visibility
            </CardTitle>
            <CardDescription>
              Recruit 619 first; Instant NDA when data is available.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {report.subsidiaries.map((sub) => (
              <div
                key={sub.entity_id}
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/entities/${sub.entity_id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {entityDisplayName({
                      name: sub.name,
                      entity_id: sub.entity_id,
                    })}
                  </Link>
                  <Badge variant="secondary">
                    Feed · {labelFinanceFeedStatus(sub.feed_status)}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs">
                  <Link
                    href={companyFinanceHref(sub.entity_id)}
                    className="text-muted-foreground underline-offset-2 hover:underline"
                  >
                    View financials
                  </Link>
                  <Link
                    href={`/entities/${sub.entity_id}`}
                    className="text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Open company
                  </Link>
                </div>
                {sub.todo ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    TODO · {sub.todo}
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            Portfolio bridge
          </h2>
          <p className="text-sm text-muted-foreground">
            Company ARR, burn, cash, and runway from portfolio snapshots.
          </p>
        </div>
        {portfolioBridge.length === 0 ? (
          <EmptyState
            title="No portfolio finance bridge yet"
            description="Portfolio company snapshots will show ARR, burn, cash, and runway here when available."
          />
        ) : (
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>ARR ($k)</TableHead>
                    <TableHead>Burn ($k)</TableHead>
                    <TableHead>Cash ($k)</TableHead>
                    <TableHead>Runway</TableHead>
                    <TableHead className="text-right">Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {portfolioBridge.map((row) => (
                    <TableRow key={row.entity_id}>
                      <TableCell>
                        <div className="font-medium">{row.company_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.source_label}
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatUsdK(row.arr_k)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatUsdK(row.net_burn_k)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatUsdK(row.cash_k)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatRunway(row.runway_mo)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={companyFinanceHref(row.entity_id)}
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          View financials
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            Finance requests
          </h2>
          <p className="text-sm text-muted-foreground">
            Open a shared-services ticket from a common finance template.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FINANCE_REQUEST_TEMPLATES.map((t) => (
            <Card key={t.template_id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.title}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Link
                  href={financeTicketHref(t.template_id, entityId.trim() || null)}
                  className="text-sm text-muted-foreground underline-offset-2 hover:underline"
                >
                  Create ticket
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            IES write-back proposals
          </h2>
          <p className="text-sm text-muted-foreground">
            Propose → dual distinct human approvers → operator executes in IES.
            Tage never silent-writes. Money is never auto-approved.
          </p>
        </div>

        {canWrite ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Propose write-back</CardTitle>
              <CardDescription>
                Creates a pending dual-approve gate only.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                Action
                <select
                  className="block h-9 rounded-md border border-border bg-background px-2 text-sm"
                  value={wbKind}
                  onChange={(e) =>
                    setWbKind(
                      e.target.value as
                        | 'ies_journal_adjustment'
                        | 'ies_vendor_bill_note'
                        | 'ies_ar_memo'
                        | 'ies_close_flag'
                        | 'ies_other_observe',
                    )
                  }
                >
                  <option value="ies_journal_adjustment">
                    Journal adjustment
                  </option>
                  <option value="ies_vendor_bill_note">Vendor bill note</option>
                  <option value="ies_ar_memo">AR memo</option>
                  <option value="ies_close_flag">Close flag</option>
                  <option value="ies_other_observe">Other observe</option>
                </select>
              </label>
              <label className="min-w-[16rem] flex-1 space-y-1 text-xs text-muted-foreground">
                Summary
                <input
                  className="block h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  value={wbSummary}
                  onChange={(e) => setWbSummary(e.target.value)}
                  placeholder="Describe the IES change for dual approval"
                />
              </label>
              <Button
                type="button"
                disabled={pending}
                onClick={proposeWriteback}
              >
                Propose
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {report.writeback_proposals.length === 0 ? (
          <EmptyState
            title="No write-back proposals"
            description="Propose an IES write-back when a human-gated change is needed. Pending dual approval is required."
          />
        ) : (
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Summary</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Gate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.writeback_proposals.map((p) => (
                    <TableRow key={p.proposal_id}>
                      <TableCell>
                        <div className="font-medium">{p.summary}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.entity_id
                            ? entityDisplayName(p.entity_id)
                            : 'Firm'}{' '}
                          · {p.proposal_id.slice(0, 8)}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{p.action_kind}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            p.status === 'dual_approved'
                              ? 'default'
                              : p.status === 'rejected'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canWrite && p.status === 'pending' ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                decideWriteback(p.proposal_id, 'approve')
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() =>
                                decideWriteback(p.proposal_id, 'reject')
                              }
                            >
                              Reject
                            </Button>
                          </div>
                        ) : p.status === 'dual_approved' ? (
                          <span className="text-xs text-muted-foreground">
                            Execute in IES
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
