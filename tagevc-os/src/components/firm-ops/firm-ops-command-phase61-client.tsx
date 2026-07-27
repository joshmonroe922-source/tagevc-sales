'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { refreshFirmOpsCommandPhase61Action } from '@/app/(app)/command-center/actions';
import { DashboardMetricBoard } from '@/components/dashboard/dashboard-metric-board';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CompanySelect } from '@/components/shared/company-select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  audienceLabel,
  boardStatusLabel,
  severityLabel,
  type FirmOpsCommandPhase61Report,
} from '@/lib/firm-ops/firm-ops-command-phase61';

export function FirmOpsCommandPhase61Client({
  report: initialReport,
  canWrite,
  initialEntityId = '',
}: {
  report: FirmOpsCommandPhase61Report;
  canWrite: boolean;
  initialEntityId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [report, setReport] = useState(initialReport);
  const [entityId, setEntityId] = useState(initialEntityId);
  const [message, setMessage] = useState<string | null>(null);

  function runRefresh() {
    start(async () => {
      setMessage(null);
      const result = await refreshFirmOpsCommandPhase61Action(
        entityId.trim() || null,
      );
      if (!result.ok) {
        setMessage(result.error);
        setReport(result.report);
        return;
      }
      setReport(result.report);
      setMessage(
        'Firm Ops command refreshed (alerts, queues, stale/breach, module nav).',
      );
      router.refresh();
    });
  }

  const serviceEntries = Object.entries(report.by_service).sort(
    (a, b) => b[1] - a[1],
  );
  const domainEntries = Object.entries(report.by_domain).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">
              Firm Ops command · Phase 61
            </CardTitle>
            <CardDescription>
              Critical alerts across services, Visionary/COO/Service Lead action
              queues, stale/breach visibility, and quick navigation into every
              major module. Never auto-approves money.
            </CardDescription>
          </div>
          <Badge variant="secondary" className="font-normal">
            {boardStatusLabel(report.alert_board_status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label
              htmlFor="p61-entity"
              className="text-xs font-medium text-muted-foreground"
            >
              Company filter
            </label>
            <CompanySelect
              id="p61-entity"
              allowAll
              allLabel="All companies"
              value={entityId}
              onChange={setEntityId}
              className="w-44"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={pending || !canWrite}
            onClick={runRefresh}
          >
            {pending ? 'Refreshing…' : 'Refresh command board'}
          </Button>
          <Link
            href="/entities/ENT-R619"
            className="text-sm font-medium text-[#3a414f] underline-offset-4 hover:underline"
          >
            Open Recruit 619 →
          </Link>
        </div>

        {message ? (
          <p className="text-sm text-muted-foreground">{message}</p>
        ) : null}

        <DashboardMetricBoard
          surface="firm-ops-command-metrics"
          columns={4}
          items={[
            {
              id: 'critical',
              label: 'Critical',
              value: String(report.critical_count),
            },
            {
              id: 'warning',
              label: 'Warning',
              value: String(report.warning_count),
            },
            {
              id: 'stale',
              label: 'Stale items',
              value: String(report.stale_count),
            },
            {
              id: 'breaches',
              label: 'Breaches',
              value: String(report.breach_count),
            },
          ]}
        />

        <section className="space-y-2">
          <h3 className="text-sm font-medium tracking-wide text-[#7c7871] uppercase">
            Critical alerts by service
          </h3>
          {serviceEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No service alert rollup yet. Refresh to probe Phase 54–60 evidence.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {serviceEntries.map(([service, count]) => (
                <div
                  key={service}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="capitalize text-muted-foreground">
                    {service.replaceAll('_', ' ')}
                  </span>
                  <span className="font-semibold tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium tracking-wide text-[#7c7871] uppercase">
              Stale / breach board
            </h3>
            <Badge variant="outline" className="font-normal">
              {boardStatusLabel(String(report.stale_board_status))}
            </Badge>
          </div>
          {domainEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No stale/breach domains captured yet.
            </p>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border">
              {domainEntries.map(([domain, count]) => (
                <div
                  key={domain}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <span className="capitalize text-muted-foreground">
                    {domain.replaceAll('_', ' ')}
                  </span>
                  <span className="font-semibold tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium tracking-wide text-[#7c7871] uppercase">
            Action queues
          </h3>
          {report.queues.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Queues empty until refresh (Visionary · COO · Service Leads).
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-3">
              {report.queues.map((queue) => (
                <div
                  key={queue.audience}
                  className="space-y-2 rounded-lg border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {audienceLabel(queue.audience)}
                    </p>
                    <Badge variant="outline" className="font-normal">
                      {boardStatusLabel(String(queue.board_status))}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Open {queue.open_count} · overdue {queue.overdue_count}
                  </p>
                  <ul className="space-y-1.5">
                    {queue.queue_items.map((item) => (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          className="flex items-center justify-between gap-2 text-sm hover:underline"
                        >
                          <span>
                            {item.title}{' '}
                            <span className="text-xs text-muted-foreground">
                              ({severityLabel(item.severity)})
                            </span>
                          </span>
                          <span className="tabular-nums font-medium">
                            {item.count}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium tracking-wide text-[#7c7871] uppercase">
            Jump to
          </h3>
          <div className="flex flex-wrap gap-2">
            {report.modules.map((mod) => (
              <Link
                key={mod.module_key}
                href={mod.href}
                className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted"
              >
                {mod.label}
              </Link>
            ))}
          </div>
        </section>

        {report.recent_alerts.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium tracking-wide text-[#7c7871] uppercase">
              Recent ops alerts
            </h3>
            <div className="space-y-1">
              {report.recent_alerts.slice(0, 8).map((alert, idx) => (
                <div
                  key={String(alert.alert_id ?? idx)}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-1.5 text-sm last:border-0"
                >
                  <span>
                    {String(alert.alert_kind ?? 'alert')} ·{' '}
                    {severityLabel(String(alert.severity ?? 'info'))}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {alert.created_at
                      ? new Date(String(alert.created_at)).toLocaleString()
                      : '—'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <p className="text-xs text-muted-foreground">{report.todo}</p>
      </CardContent>
    </Card>
  );
}
