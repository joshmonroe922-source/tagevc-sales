import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function OperationalHealthSummary({
  health,
}: {
  health: {
    evaluations: Array<Record<string, unknown>>;
    alerts: Array<Record<string, unknown>>;
    workerRuns: Array<Record<string, unknown>>;
    error?: string;
  };
}) {
  const services = ['marketing', 'docusign', 'intune', 'snapshot'];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            Operational health
          </h2>
          <p className="text-sm text-muted-foreground">
            Phase 37 SLO evaluations, durable alerts, and worker history.
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
                  <p key={String(alert.alert_id)}>
                    {String(alert.metric_key).replaceAll('_', ' ')}
                  </p>
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
    </section>
  );
}
