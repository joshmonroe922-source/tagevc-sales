import Link from 'next/link';
import { BandBadge } from '@/components/shared-services/band-badge';
import { CreateTicketForm } from '@/components/shared-services/create-ticket-form';
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
  CONFIDENCE_AUTO_MIN,
  CONFIDENCE_DRAFT_MIN,
  CURRENT_POLICY_VERSION,
} from '@/lib/shared-services/diagnose';
import {
  getSsHubCardModules,
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

type Props = {
  searchParams?: Promise<{ service?: string; entity?: string }>;
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

  const ctx = await getSessionContext();
  const firmWide = ctx
    ? isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)
    : false;
  const [tickets, operationalHealth, policyAdministration, inboxReport] =
    await Promise.all([
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

  const modules = getSsHubCardModules();
  const byService = new Map<string, typeof modules>();
  for (const m of modules) {
    const list = byService.get(m.service) ?? [];
    list.push(m);
    byService.set(m.service, list);
  }
  const serviceOrder = ['Legal', 'IT', 'Marketing', 'Finance', 'HR', 'All'];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Shared Services
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ticketing plus Legal, IT, and Marketing modules for Tage VC and
          subsidiaries. Phase 54 unified inbox adds SLA boards, ownership, and
          escalation across Finance · Legal · HR · IT · Marketing. Policy
          version <code>{CURRENT_POLICY_VERSION}</code>. AUTO ≥
          {CONFIDENCE_AUTO_MIN}% on allow-list; DRAFT {CONFIDENCE_DRAFT_MIN}
          –89%; ESCALATE &lt;{CONFIDENCE_DRAFT_MIN}%, P0, or forbid-list.
        </p>
      </header>

      <OperationalHealthSummary health={operationalHealth} />

      {policyAdministration ? (
        <SloPolicyAdmin {...policyAdministration} />
      ) : null}

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            Service modules
          </h2>
          <p className="text-sm text-muted-foreground">
            Firm-wide hubs with entity-scoped data where applicable. Finance
            control plane is live; HR remains a planned stub — tickets still
            appear in the unified inbox.
          </p>
        </div>
        <div className="space-y-5">
          {serviceOrder
            .filter((s) => byService.has(s))
            .map((service) => (
              <div key={service} className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {service}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {(byService.get(service) ?? []).map((m) => (
                    <Link key={m.id} href={m.href} className="group block">
                      <Card className="h-full transition-colors group-hover:border-[#3a414f]/35">
                        <CardHeader>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{m.service}</Badge>
                            <Badge
                              variant={
                                m.status === 'live' ? 'default' : 'secondary'
                              }
                            >
                              {ssHubStatusLabel(m.status)}
                            </Badge>
                          </div>
                          <CardTitle className="font-heading text-base">
                            {m.title}
                          </CardTitle>
                          <CardDescription>{m.description}</CardDescription>
                        </CardHeader>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {AUTONOMY_BANDS.map((band) => (
          <Card key={band}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <BandBadge band={band} /> open
              </CardDescription>
              <CardTitle className="font-heading text-2xl tabular-nums">
                {bands[band]}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <SsUnifiedInbox
        tickets={tickets}
        report={inboxReport}
        initialService={initialService}
        initialEntityId={initialEntityId}
      />

      <SsMultiSubOperatorPanels
        tickets={tickets}
        health={buildMultiSubHealthFromTickets(tickets, {
          feed_status: 'partial',
        })}
      />

      <CreateTicketForm />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Forbid-list (never AUTO)</CardTitle>
            <CardDescription>§7D — even at 99% confidence.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {FORBID_LIST.map((r) => (
              <div key={r.code} className="rounded-md border border-border px-3 py-2">
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
              <div key={r.code} className="rounded-md border border-border px-3 py-2">
                <p className="font-medium">{r.label}</p>
                <p className="text-xs text-muted-foreground">{r.code}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
