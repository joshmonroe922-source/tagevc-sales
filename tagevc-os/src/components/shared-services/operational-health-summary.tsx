'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
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
  acknowledgeSloAlertAction,
  reassignSloAlertAction,
} from '@/app/(app)/shared-services/actions';

export function OperationalHealthSummary({
  health,
}: {
  health: {
    evaluations: Array<Record<string, unknown>>;
    alerts: Array<Record<string, unknown>>;
    workerRuns: Array<Record<string, unknown>>;
    owners: Array<Record<string, unknown>>;
    ownerProfiles: Array<Record<string, unknown>>;
    workerDefinitions: Array<Record<string, unknown>>;
    deliveryJobs: Array<Record<string, unknown>>;
    error?: string;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [ownerSelections, setOwnerSelections] = useState<Record<string, string>>({});
  const services = ['marketing', 'docusign', 'intune', 'snapshot'];
  function acknowledge(alert: Record<string, unknown>) {
    startTransition(async () => {
      const result = await acknowledgeSloAlertAction({
        alertId: String(alert.alert_id),
        rowVersion: Number(alert.row_version),
        note: 'Acknowledged from operational health dashboard',
      });
      setMessage(result.ok ? result.message ?? 'Acknowledged' : result.error);
      if (result.ok) router.refresh();
    });
  }
  function reassign(alert: Record<string, unknown>) {
    const alertId = String(alert.alert_id);
    const ownerId = ownerSelections[alertId] ?? String(alert.owner_id ?? '');
    if (!ownerId) return;
    startTransition(async () => {
      const result = await reassignSloAlertAction({
        alertId: String(alert.alert_id),
        rowVersion: Number(alert.row_version),
        ownerId,
        note: 'Reassigned from operational health dashboard',
      });
      setMessage(result.ok ? result.message ?? 'Reassigned' : result.error);
      if (result.ok) router.refresh();
    });
  }
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            Operational health
          </h2>
          <p className="text-sm text-muted-foreground">
            Phase 38 versioned SLOs, ownership, delivery, and worker freshness.
          </p>
        </div>
        <Badge
          variant={
            health.error || health.alerts.length ? 'destructive' : 'secondary'
          }
        >
          {health.error
            ? 'monitoring unavailable'
            : `${health.alerts.length} open alert${health.alerts.length === 1 ? '' : 's'}`}
        </Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {services.map((service) => {
          const evaluations = health.evaluations.filter(
            (item) => item.service === service,
          );
          if (evaluations.length === 0 && service === 'snapshot') return null;
          const alerts = health.alerts.filter((item) => item.service === service);
          const latestWorker = health.workerRuns.find(
            (item) => item.service === service,
          );
          const severity = health.error
            ? 'unknown'
            : alerts.some((item) => item.severity === 'critical')
            ? 'critical'
            : alerts.length
              ? 'warning'
              : evaluations.some((item) =>
                  ['warning', 'critical', 'unknown'].includes(
                    String(item.severity),
                  ),
                )
                ? 'unknown'
                : 'healthy';
          return (
            <Card key={service}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm capitalize">
                  {service}
                  <Badge
                    variant={
                      severity === 'critical'
                        ? 'destructive'
                        : severity === 'healthy'
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {severity}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {evaluations.length} current metric
                  {evaluations.length === 1 ? '' : 's'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-xs">
                {alerts.slice(0, 2).map((alert) => (
                  <div key={String(alert.alert_id)} className="space-y-1">
                    <p>
                      {String(alert.metric_key).replaceAll('_', ' ')} ·{' '}
                      {alert.owner_id
                        ? `owner ${
                            String(
                              health.ownerProfiles.find(
                                (owner) => owner.id === alert.owner_id,
                              )?.full_name ??
                                health.ownerProfiles.find(
                                  (owner) => owner.id === alert.owner_id,
                                )?.email ??
                                alert.owner_id,
                            )
                          }`
                        : 'unowned'}
                    </p>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || Boolean(alert.acknowledged_at)}
                        onClick={() => acknowledge(alert)}
                      >
                        {alert.acknowledged_at ? 'Acknowledged' : 'Acknowledge'}
                      </Button>
                      <select
                        aria-label="Named alert owner"
                        value={
                          ownerSelections[String(alert.alert_id)] ??
                          String(alert.owner_id ?? '')
                        }
                        onChange={(event) =>
                          setOwnerSelections((current) => ({
                            ...current,
                            [String(alert.alert_id)]: event.target.value,
                          }))
                        }
                        className="h-8 min-w-0 rounded-md border bg-background px-1 text-xs"
                      >
                        <option value="">Select owner</option>
                        {health.ownerProfiles.map((owner) => (
                          <option key={String(owner.id)} value={String(owner.id)}>
                            {String(owner.full_name ?? owner.email)}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => reassign(alert)}
                      >
                        Reassign
                      </Button>
                    </div>
                  </div>
                ))}
                <p className="text-muted-foreground">
                  Last worker:{' '}
                  {latestWorker
                    ? `${String(latestWorker.status)} · ${String(
                        latestWorker.started_at,
                      ).slice(0, 16)}`
                    : 'not recorded'}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Worker cadence</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {health.workerDefinitions.map((definition) => {
              const run = health.workerRuns.find(
                (item) =>
                  item.service === definition.service &&
                  item.worker_name === definition.worker_name,
              );
              const ageSeconds = run
                ? (Date.now() - Date.parse(String(run.started_at))) / 1000
                : definition.latest_started_at
                  ? (Date.now() -
                      Date.parse(String(definition.latest_started_at))) /
                    1000
                  : Number.POSITIVE_INFINITY;
              const stale = Boolean(
                definition.stale ??
                  ageSeconds > Number(definition.stale_after_seconds ?? 0),
              );
              return (
                <p key={`${String(definition.service)}:${String(definition.worker_name)}`}>
                  {String(definition.worker_name)} · every{' '}
                  {Number(definition.cadence_seconds) / 60}m ·{' '}
                  <span className={stale ? 'text-destructive' : 'text-emerald-700'}>
                    {stale ? 'stale' : 'current'}
                  </span>
                </p>
              );
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Alert delivery</CardTitle>
            <CardDescription>
              {health.deliveryJobs.length} queued, retrying, or failed job
              {health.deliveryJobs.length === 1 ? '' : 's'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {health.deliveryJobs.slice(0, 5).map((job) => (
              <p key={String(job.job_id)}>
                {String(job.adapter)} · {String(job.status)} · attempt{' '}
                {String(job.attempt_count)}
              </p>
            ))}
          </CardContent>
        </Card>
      </div>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </section>
  );
}
