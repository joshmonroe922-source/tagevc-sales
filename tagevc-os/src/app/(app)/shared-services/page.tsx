import Link from 'next/link';
import { BandBadge } from '@/components/shared-services/band-badge';
import { CreateTicketForm } from '@/components/shared-services/create-ticket-form';
import { SsHubCommandStrip } from '@/components/shared-services/ss-hub-command-strip';
import { SsUnifiedInbox } from '@/components/shared-services/ss-unified-inbox';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { listScopedTickets } from '@/lib/data/pipeline-scope';
import { FORBID_LIST } from '@/lib/shared-services/forbid-list';
import { ALLOW_LIST } from '@/lib/shared-services/allow-list';
import {
  getSsFunctionModules,
  ssHubStatusLabel,
} from '@/lib/shared-services/modules';
import { getSharedServicesInboxPhase54Report } from '@/lib/shared-services/shared-services-inbox-phase54-server';
import { AUTONOMY_BANDS } from '@/lib/types';
import type { AutonomyBand, SsService } from '@/lib/types';
import { SS_SERVICES } from '@/lib/types';
import { OperationalHealthSummary } from '@/components/shared-services/operational-health-summary';
import { SsMultiSubOperatorPanels } from '@/components/shared-services/ss-multi-sub-operator-panels';
import { listOperationalHealth } from '@/lib/shared-services/operational-health';
import { buildMultiSubHealthFromTickets } from '@/lib/multi-sub/health';
import { getSessionContext } from '@/lib/rbac/session';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { SloPolicyAdmin } from '@/components/shared-services/slo-policy-admin';
import { listSloPolicyAdministration } from '@/lib/shared-services/slo-policy';
import { getSscHubGlance } from '@/lib/shared-services/ssc-checklist/hub-glance';
import { ensurePeriodInstances, seedAllCompanyAudits } from '@/lib/shared-services/ssc-checklist/engine';
import { escalateOverdueSscTasks } from '@/lib/shared-services/ssc-checklist/escalate';

type Props = {
  searchParams?: Promise<{
    service?: string;
    entity?: string;
    template?: string;
  }>;
};

export default async function SharedServicesPage({ searchParams }: Props) {
  const params = (await searchParams) ?? {};
  const initialServiceRaw = params.service?.trim() ?? '';
  const initialService: SsService | 'All' = SS_SERVICES.includes(
    initialServiceRaw as SsService,
  )
    ? (initialServiceRaw as SsService)
    : 'All';
  const initialEntityId = params.entity?.trim() ?? '';
  const initialTemplate = params.template?.trim() ?? '';

  const ctx = await getSessionContext();
  const firmWide = ctx
    ? isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)
    : false;

  // Best-effort: ensure current+next monthly instances, audits, escalations
  try {
    await ensurePeriodInstances({
      function: 'all',
      period_type: 'monthly',
      scope_mode: 'parent_subs',
      include_next: true,
    });
    await seedAllCompanyAudits();
    await escalateOverdueSscTasks({ actorId: ctx?.profile.id ?? null });
  } catch {
    // fail-soft — hub still loads
  }

  const [
    tickets,
    operationalHealth,
    policyAdministration,
    inboxReport,
    glance,
  ] = await Promise.all([
    listScopedTickets(),
    listOperationalHealth({
      firmWide,
      entityId: ctx?.profile.entity_id ?? null,
    }),
    firmWide ? listSloPolicyAdministration() : Promise.resolve(null),
    getSharedServicesInboxPhase54Report({
      entityId: initialEntityId || null,
      service: initialService === 'All' ? null : initialService,
    }),
    getSscHubGlance(),
  ]);

  const bands: Record<AutonomyBand, number> = {
    AUTO: 0,
    DRAFT: 0,
    ESCALATE: 0,
  };
  for (const t of tickets) {
    if (t.status === 'Closed' || t.status === 'Resolved') continue;
    bands[t.autonomy_band] += 1;
  }

  const functionModules = getSsFunctionModules();

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Shared Services Center
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Checklists and audits are the daily control surface. Cadence runs on
          schedule — overdue work escalates to tickets and in-app alerts without
          waiting for someone to open this page.
        </p>
      </header>

      <SsHubCommandStrip glance={glance} />

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            Function homes
          </h2>
          <p className="text-sm text-muted-foreground">
            Deep tools for each SSC function. Period checklists and audits sit
            above — use those for cadence across companies.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {functionModules.map((m) => {
            const fnKey =
              m.id === 'it_assets'
                ? 'it'
                : m.id === 'docusign'
                  ? 'legal'
                  : m.id;
            return (
              <Card
                key={m.id}
                className="h-full transition-colors hover:border-[#3a414f]/35"
              >
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{m.short ?? m.service}</Badge>
                    <Badge
                      variant={m.status === 'live' ? 'default' : 'secondary'}
                    >
                      {ssHubStatusLabel(m.status)}
                    </Badge>
                  </div>
                  <CardTitle className="font-heading text-base">
                    <Link
                      href={m.href}
                      className="hover:underline underline-offset-2"
                    >
                      {m.title}
                    </Link>
                  </CardTitle>
                  <CardDescription>{m.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3 text-xs">
                  <Link
                    href={m.href}
                    className="font-medium text-[#3a414f] underline-offset-2 hover:underline"
                  >
                    Open home →
                  </Link>
                  <Link
                    href={`/shared-services/checklists?function=${fnKey}&period=monthly&scope=parent_subs&time=current`}
                    className="text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Period checklist
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
              Work queue
            </h2>
            <p className="text-sm text-muted-foreground">
              Ticket intake, SLA, and autonomy bands across companies.
            </p>
          </div>
          <div className="flex gap-2">
            {AUTONOMY_BANDS.map((band) => (
              <div
                key={band}
                className="rounded-md border border-border px-3 py-1.5 text-center"
              >
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <BandBadge band={band} />
                </div>
                <div className="font-heading text-lg tabular-nums">
                  {bands[band]}
                </div>
              </div>
            ))}
          </div>
        </div>

        <SsUnifiedInbox
          tickets={tickets}
          report={inboxReport}
          initialService={initialService}
          initialEntityId={initialEntityId}
        />

        <CreateTicketForm
          prefill={{
            service: initialService === 'All' ? undefined : initialService,
            template: initialTemplate || undefined,
            entityId: initialEntityId || undefined,
          }}
        />
      </section>

      <details className="rounded-lg border border-border bg-[#f7f8fa] p-4">
        <summary className="cursor-pointer font-heading text-base font-semibold text-[#3a414f]">
          Ops health & multi-company panels
        </summary>
        <div className="mt-4 space-y-6">
          <OperationalHealthSummary health={operationalHealth} />
          <SsMultiSubOperatorPanels
            tickets={tickets}
            health={buildMultiSubHealthFromTickets(tickets, {
              feed_status: 'partial',
            })}
          />
        </div>
      </details>

      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer font-heading text-base font-semibold text-[#3a414f]">
          Governance · autonomy rules & SLO policy
        </summary>
        <div className="mt-4 space-y-6">
          {policyAdministration ? (
            <SloPolicyAdmin {...policyAdministration} />
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Forbid-list (never AUTO)
                </CardTitle>
                <CardDescription>
                  §7D — even at 99% confidence.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {FORBID_LIST.map((r) => (
                  <div
                    key={r.code}
                    className="rounded-md border border-border px-3 py-2"
                  >
                    <p className="font-medium">{r.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.code} · Human: {r.human_required}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">AUTO allow-list (v1)</CardTitle>
                <CardDescription>
                  COO-signed low-risk actions only. Expansion requires written
                  sign-off (§7E).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {ALLOW_LIST.map((r) => (
                  <div
                    key={r.code}
                    className="rounded-md border border-border px-3 py-2"
                  >
                    <p className="font-medium">{r.label}</p>
                    <p className="text-xs text-muted-foreground">{r.code}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </details>
    </div>
  );
}
