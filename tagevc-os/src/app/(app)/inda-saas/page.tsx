import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LocalDateTime } from '@/components/ui/local-datetime';
import {
  SAAS_REPORT_ROLE_LABELS,
  kpisForRole,
  reportsForRole,
  resolveSaasReportRole,
  SAAS_REPORTS,
  type SaasReportRole,
} from '@/lib/inda-saas/roles';
import { buildIndaParentSaasSnapshot } from '@/lib/inda-saas/snapshot-server';
import { getSessionContext } from '@/lib/rbac/session';

export default async function IndaSaasPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  const sp = (await searchParams) ?? {};
  const roleRaw = typeof sp.role === 'string' ? sp.role : '';
  const canSwitch = session?.realRole === 'visionary';
  const defaultRole = resolveSaasReportRole({
    appRole: session?.profile.role,
    realRole: session?.realRole,
  });
  // Parent page focuses on VC / Partner / COO; allow Visionary to switch
  const parentRoles: SaasReportRole[] = [
    'vc_leadership',
    'partner',
    'coo_subsidiaries',
    'subsidiary_leader',
  ];
  const role: SaasReportRole =
    canSwitch && parentRoles.includes(roleRaw as SaasReportRole)
      ? (roleRaw as SaasReportRole)
      : parentRoles.includes(defaultRole)
        ? defaultRole
        : 'vc_leadership';

  const snapshot = await buildIndaParentSaasSnapshot();
  const cards = kpisForRole(role)
    .map((id) => snapshot.metrics[id])
    .filter(Boolean);
  const reportIds = reportsForRole(role);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Portfolio · Instant NDA
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
            {snapshot.company_name} · SaaS
          </h1>
          <Badge variant="outline" className="capitalize">
            {snapshot.freshness}
          </Badge>
          <Link
            href="/entities/ENT-INDA"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Open Instant NDA company →
          </Link>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {SAAS_REPORT_ROLE_LABELS[role]} view · {snapshot.source_note} As of{' '}
          <LocalDateTime value={snapshot.generated_at} fallback="—" />.
        </p>
        {canSwitch ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {parentRoles.map((r) => (
              <Link
                key={r}
                href={`/inda-saas?role=${r}`}
                className={`rounded-md border px-2 py-1 text-xs ${
                  r === role
                    ? 'border-foreground bg-muted'
                    : 'border-border text-muted-foreground'
                }`}
              >
                {SAAS_REPORT_ROLE_LABELS[r]}
              </Link>
            ))}
          </div>
        ) : null}
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.kpi_id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm">{c.name}</CardTitle>
                <Badge variant="outline" className="capitalize">
                  {c.data_state.replace('_', ' ')}
                </Badge>
              </div>
              <CardDescription className="line-clamp-2">
                {c.plain_definition}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Actual · </span>
                {c.actual ?? '—'}
              </p>
              <p>
                <span className="text-muted-foreground">Goal · </span>
                {c.goal ?? 'Goal not set'}
              </p>
              <p className="text-xs text-muted-foreground">{c.variance_label}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-lg">Reports for this role</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {SAAS_REPORTS.filter((r) => reportIds.includes(r.id)).map((r) => (
            <div
              key={r.id}
              className="rounded-md border border-border px-3 py-3 text-sm"
            >
              <p className="font-medium">{r.name}</p>
              <p className="text-xs text-muted-foreground">{r.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Full interactive reports live on{' '}
                <a
                  href="https://portal.instantnda.us/reports"
                  className="underline underline-offset-2"
                  target="_blank"
                  rel="noreferrer"
                >
                  portal.instantnda.us/reports
                </a>
                .
              </p>
            </div>
          ))}
        </div>
      </section>

      <p className="text-sm text-muted-foreground">
        Company OS:{' '}
        <Link href="/entities" className="underline underline-offset-2">
          Entities
        </Link>
        {' · '}
        Operating portal:{' '}
        <a
          href="https://portal.instantnda.us/dashboard"
          className="underline underline-offset-2"
          target="_blank"
          rel="noreferrer"
        >
          Instant NDA Dashboard
        </a>
      </p>
    </div>
  );
}
