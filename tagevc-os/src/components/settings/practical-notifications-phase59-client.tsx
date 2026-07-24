'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  refreshNotificationInboxPhase59Action,
  routeDemoNotificationPhase59Action,
} from '@/app/(app)/settings/notifications/actions';
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
  boardStatusLabel,
  channelLabel,
  type PracticalNotificationsPhase59Report,
} from '@/lib/notifications/practical-notifications-phase59';

export function PracticalNotificationsPhase59Client({
  report: initialReport,
  canWrite,
  initialEntityId = '',
}: {
  report: PracticalNotificationsPhase59Report;
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
      const result = await refreshNotificationInboxPhase59Action(
        entityId.trim() || null,
      );
      if (!result.ok) {
        setMessage(result.error);
        setReport(result.report);
        return;
      }
      setReport(result.report);
      setMessage(
        'Inbox completeness refreshed (in-app + critical email evidence; full_push=false).',
      );
      router.refresh();
    });
  }

  function routeDemo(severity: 'info' | 'critical') {
    start(async () => {
      setMessage(null);
      const result = await routeDemoNotificationPhase59Action({
        entityId: entityId.trim() || null,
        severity,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setReport(result.report);
      setMessage(
        severity === 'critical'
          ? 'Critical event routed to you in-app (optional critical email via digest).'
          : 'Owner assignment routed to you in-app.',
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">
              Practical notifications · Phase 59
            </CardTitle>
            <CardDescription>
              Inbox completeness, owner/assignee routing, and optional critical
              email digests (entity-aware, e.g. ENT-R619). Reliability over
              channel expansion — not a full push product.
            </CardDescription>
          </div>
          <Badge variant="secondary" className="font-normal">
            {boardStatusLabel(report.board_status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label
              htmlFor="p59-entity"
              className="text-xs font-medium text-muted-foreground"
            >
              Company filter
            </label>
            <CompanySelect
              id="p59-entity"
              allowAll
              allLabel="All companies"
              value={entityId}
              onChange={setEntityId}
              className="w-44"
            />
          </div>
          <Button type="button" size="sm" disabled={pending} onClick={runRefresh}>
            {pending ? 'Refreshing…' : 'Refresh board'}
          </Button>
          {canWrite ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => routeDemo('info')}
              >
                Route demo (owner)
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => routeDemo('critical')}
              >
                Route demo (critical)
              </Button>
            </>
          ) : null}
          <Link
            href="/activity"
            className="text-sm font-medium text-[#3a414f] underline-offset-4 hover:underline"
          >
            Open inbox →
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Unread total" value={String(report.unread_total)} />
          <Metric
            label="Unread critical"
            value={String(report.unread_critical)}
          />
          <Metric
            label="Owner-routed unread"
            value={String(report.unread_owner_routed)}
          />
          <Metric
            label="Prefs configured"
            value={String(report.prefs_configured)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Metric
            label="Critical email delivered (7d)"
            value={String(report.critical_email_delivered_7d)}
          />
          <Metric
            label="Critical email failed (7d)"
            value={String(report.critical_email_failed_7d)}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Contract {report.contract_version} · full_push=
          {String(report.full_push)} · email_critical_only=
          {String(report.email_critical_only)} · reuses digest route + prefs.
          {report.captured_at
            ? ` · Captured ${new Date(report.captured_at).toLocaleString()}`
            : null}
        </p>

        {report.recent_deliveries.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
              Recent delivery evidence
            </p>
            <ul className="space-y-1.5">
              {report.recent_deliveries.slice(0, 6).map((row) => (
                <li
                  key={String(row.evidence_id)}
                  className="rounded-md border border-border px-3 py-2 text-xs"
                >
                  <span className="font-medium">
                    {channelLabel(String(row.channel ?? 'in_app'))}
                  </span>
                  {' · '}
                  {String(row.delivery_status ?? '—')}
                  {' · '}
                  {String(row.event_kind ?? '—')}
                  {row.entity_id ? ` · ${String(row.entity_id)}` : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {message ? (
          <p className="text-sm text-emerald-700">{message}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">{report.todo}</p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-[#3a414f]">{value}</p>
    </div>
  );
}
