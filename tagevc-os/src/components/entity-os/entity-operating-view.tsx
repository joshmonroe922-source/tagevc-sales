import Link from 'next/link';
import { EntitySectionNav } from '@/components/entity-os/entity-section-nav';
import { StandardBadge } from '@/components/entity-os/standard-badge';
import { StartChatButton } from '@/components/messaging/start-chat-button';
import { HealthBadge } from '@/components/portfolio/health-badge';
import {
  EntityMasterForm,
  PortfolioPulseForm,
} from '@/components/portfolio/master-data-forms';
import { BandBadge } from '@/components/shared-services/band-badge';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  formatDate,
  formatPct,
  formatRunway,
  formatUsdK,
} from '@/lib/format';
import { CORE_KPI_CATALOG } from '@/lib/portfolio/core-kpis';
import type { EntityLinkedTask, EntityOperatingView } from '@/lib/types';

function formatKpiValue(
  valueNum: number | null,
  valueText: string | null,
  unit: string | null,
): string {
  if (valueText) return valueText;
  if (valueNum == null) return '—';
  if (unit === '%') return formatPct(valueNum);
  if (unit === '$k') return formatUsdK(valueNum);
  if (unit === 'mo') return formatRunway(valueNum);
  if (unit === '$') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(valueNum);
  }
  return String(valueNum);
}

function TaskTable({
  tasks,
  empty,
}: {
  tasks: EntityLinkedTask[];
  empty: string;
}) {
  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Task</TableHead>
            <TableHead>Track</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Due</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((t) => (
            <TableRow key={`${t.track}-${t.task_id}`}>
              <TableCell>
                <Link
                  href={t.href}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {t.title}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {t.task_id} · {t.parent_id}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{t.track}</Badge>
              </TableCell>
              <TableCell className="text-sm">{t.process_stage ?? '—'}</TableCell>
              <TableCell>{t.priority}</TableCell>
              <TableCell>{t.status}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(t.due_date)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function EntityOperatingViewPanel({
  view,
  backHref = '/entities',
  backLabel = '← Entities',
}: {
  view: EntityOperatingView;
  backHref?: string;
  backLabel?: string;
}) {
  const { entity, portfolio, pnl } = view;
  const requiredCoreKeys = new Set<string>(
    CORE_KPI_CATALOG.filter((c) => c.required).map((c) => c.kpi_key),
  );
  const presentKeys = new Set(view.core_kpis.map((k) => k.kpi_key));
  const missingCore = CORE_KPI_CATALOG.filter(
    (c) => c.required && !presentKeys.has(c.kpi_key),
  );

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Link
          href={backHref}
          className="inline-flex text-sm text-muted-foreground hover:text-foreground"
        >
          {backLabel}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
              Subsidiary Operating System
            </p>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
              {entity.canonical_name}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{entity.entity_id}</Badge>
              <Badge variant="secondary">{entity.entity_type}</Badge>
              {entity.industry_module ? (
                <Badge variant="secondary">{entity.industry_module}</Badge>
              ) : null}
              {portfolio ? (
                <Badge variant="outline">{portfolio.portfolio_id}</Badge>
              ) : null}
              {portfolio ? <HealthBadge health={portfolio.health} /> : null}
            </div>
            {view.origin_source ? (
              <p className="text-sm text-muted-foreground">
                Lead source · <span className="font-medium text-foreground">{view.origin_source}</span>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StartChatButton
              refType="entity"
              refId={entity.entity_id}
              title={`${entity.entity_id} · ${entity.canonical_name}`}
              entityId={entity.entity_id}
            />
            {portfolio ? (
              <Link
                href={`/portfolio/${portfolio.portfolio_id}`}
                className="underline-offset-4 hover:underline"
              >
                Portfolio Active
              </Link>
            ) : null}
            <Link
              href={`/documents/entities/${entity.entity_id}`}
              className="underline-offset-4 hover:underline"
            >
              Document library
            </Link>
            <Link
              href="/deal-flow/vc/intake"
              className="underline-offset-4 hover:underline"
            >
              Lead intake
            </Link>
          </div>
        </div>
        <EntitySectionNav />
      </div>

      <section id="overview" className="scroll-mt-24 space-y-4">
        <SectionHeading
          title="Overview"
          description="Entity Master + Portfolio Active pulse. Health and Top Risk are CORE."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Entity Master</CardTitle>
                <StandardBadge standard="CORE" />
              </div>
              <CardDescription>
                Canonical registry join after close (ENT-*).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Legal name" value={entity.legal_name ?? '—'} />
              <Row label="Status" value={entity.status} />
              <Row label="Track origin" value={entity.track_origin ?? '—'} />
              <Row label="Parent" value={entity.parent_entity_id ?? '—'} />
              <Row label="QBE key" value={entity.qbe_class_or_company ?? '—'} />
              <Row label="COO owner" value={entity.coo_owner ?? '—'} />
              <Row label="Board lead" value={entity.board_lead ?? '—'} />
              <Row label="Close date" value={formatDate(entity.close_date)} />
              <Separator />
              <Row label="Notes" value={entity.notes ?? '—'} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Operating pulse</CardTitle>
                <StandardBadge standard="CORE" />
              </div>
              <CardDescription>
                Portfolio Active · period {view.period}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {portfolio ? (
                <>
                  <Row label="Top risk" value={portfolio.top_risk ?? '—'} />
                  <Row
                    label="Next milestone"
                    value={portfolio.next_milestone ?? '—'}
                  />
                  <Row
                    label="Last update"
                    value={formatDate(portfolio.last_update)}
                  />
                  <Row label="Path" value={portfolio.path ?? '—'} />
                  <Row label="Deal ID" value={portfolio.deal_id ?? '—'} />
                  <Separator />
                  <Row label="Notes" value={portfolio.notes ?? '—'} />
                </>
              ) : (
                <p className="text-muted-foreground">
                  No Portfolio Active row (RE assets use RE Portfolio).
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <EntityMasterForm entity={entity} />
          {portfolio ? <PortfolioPulseForm company={portfolio} /> : null}
        </div>
      </section>

      <section id="financials" className="scroll-mt-24 space-y-4">
        <SectionHeading
          title="Financials"
          description="CORE P&L ($k) must match Portfolio Roll-up for the period."
        />
        {portfolio ? (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="ARR ($k)" value={formatUsdK(portfolio.arr_k)} core />
            <Metric
              label="Net Burn ($k)"
              value={formatUsdK(portfolio.net_burn_k)}
              core
            />
            <Metric label="Cash ($k)" value={formatUsdK(portfolio.cash_k)} core />
            <Metric
              label="Runway"
              value={formatRunway(portfolio.runway_mo)}
              core
            />
          </section>
        ) : null}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">
                CORE P&L · {view.period}
              </CardTitle>
              <StandardBadge standard="CORE" />
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {pnl ? (
              <>
                <Row label="Revenue / ARR" value={`$${formatUsdK(pnl.revenue_arr_k)}k`} />
                <Row label="COGS" value={`$${formatUsdK(pnl.cogs_k)}k`} />
                <Row label="OpEx" value={`$${formatUsdK(pnl.opex_k)}k`} />
                <Row label="Net Burn" value={`$${formatUsdK(pnl.net_burn_k)}k`} />
                <Row
                  label="Ending Cash"
                  value={`$${formatUsdK(pnl.ending_cash_k)}k`}
                />
                <Row
                  label="Gross margin"
                  value={
                    pnl.revenue_arr_k > 0
                      ? formatPct(
                          (pnl.revenue_arr_k - pnl.cogs_k) / pnl.revenue_arr_k,
                        )
                      : '—'
                  }
                />
              </>
            ) : (
              <p className="text-muted-foreground">No P&L pack for this period.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <section id="core-kpis" className="scroll-mt-24 space-y-4">
        <SectionHeading
          title="CORE KPIs"
          description="Required every reporting cycle. Missing CORE >1 cycle without Visionary exception → Health ≤ At Risk."
        />
        {missingCore.length > 0 ? (
          <p className="text-sm text-[#9f957c]">
            Missing required CORE keys: {missingCore.map((c) => c.label).join(', ')}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Full CORE pack present for {view.period}.
          </p>
        )}
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>KPI</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Roll-up</TableHead>
                <TableHead>Standard</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.core_kpis.map((k) => (
                <TableRow key={k.kpi_key}>
                  <TableCell>
                    <span className="font-medium">{k.label}</span>
                    {requiredCoreKeys.has(k.kpi_key) ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        required
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-muted-foreground">
                        optional when On Track
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatKpiValue(k.value_num, k.value_text, k.unit)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{k.method}</Badge>
                  </TableCell>
                  <TableCell>
                    <StandardBadge standard="CORE" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section id="flex-kpis" className="scroll-mt-24 space-y-4">
        <SectionHeading
          title="FLEX KPIs"
          description="Industry-module add-ons only. Never SUM/WEIGHTED into Portfolio Revenue, Burn, or Cash."
        />
        {view.flex_kpis.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              No FLEX KPIs for this industry module
              {entity.industry_module ? ` (${entity.industry_module})` : ''}.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {view.flex_kpis.map((k) => (
              <Card key={k.flex_key}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardDescription>{k.label}</CardDescription>
                    <StandardBadge standard="FLEX" />
                  </div>
                  <CardTitle className="font-heading text-2xl tabular-nums">
                    {formatKpiValue(k.value_num, k.value_text, k.unit)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  {k.industry_module} · entity detail only
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section id="leads" className="scroll-mt-24 space-y-4">
        <SectionHeading
          title="Lead intake"
          description="Inbound → Pipeline → Deal → Entity. Join on company_name pre-close; related_entity_id for follow-ons."
        />
        {view.leads.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No linked leads.{' '}
            <Link
              href="/deal-flow/vc/intake"
              className="underline underline-offset-2"
            >
              Open intake
            </Link>
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Lead</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.leads.map((l) => (
                  <TableRow key={l.lead_id}>
                    <TableCell>
                      {l.archived_at ? (
                        <span className="font-medium">{l.company_name}</span>
                      ) : (
                        <Link
                          href={`/deal-flow/vc/leads/${l.lead_id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {l.company_name}
                        </Link>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {l.lead_id}
                        {l.deal_id ? ` · ${l.deal_id}` : ''}
                        {l.archived_at ? ' · archived' : ''}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{l.source ?? '—'}</div>
                      {l.source_detail ? (
                        <div className="text-xs text-muted-foreground">
                          {l.source_detail}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>{l.stage}</TableCell>
                    <TableCell>{l.outcome ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(l.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {view.deals.length > 0 ? (
          <div className="flex flex-wrap gap-2 text-sm">
            {view.deals.map((d) => (
              <Link
                key={d.deal_id}
                href={`/deal-flow/vc/deals/${d.deal_id}`}
                className="rounded-md border border-border px-2.5 py-1 hover:bg-muted/40"
              >
                {d.deal_id} · {d.exec_stage}
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      <section id="tasks" className="scroll-mt-24 space-y-6">
        <SectionHeading
          title="Tasks & workflow"
          description="Deal Flow (VC / M&A / RE) and Shared Services kept in separate lists."
        />
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-[#3a414f]">Deal Flow</h3>
          <TaskTable
            tasks={view.tasks.deal_flow}
            empty="No open Deal Flow tasks linked to this entity."
          />
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-[#3a414f]">Shared Services</h3>
          <TaskTable
            tasks={view.tasks.shared_services}
            empty="No open Shared Services tickets for this entity."
          />
        </div>
      </section>

      <section id="docs" className="scroll-mt-24 space-y-4">
        <SectionHeading
          title="Documents"
          description="Library paths under /Entities/{entity_id}/…"
        />
        {view.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents yet.{' '}
            <Link
              href={`/documents/entities/${entity.entity_id}`}
              className="underline underline-offset-2"
            >
              Open library
            </Link>
          </p>
        ) : (
          <div className="space-y-2">
            {view.documents.map((d) => (
              <Link
                key={d.doc_id}
                href={`/documents/${d.doc_id}`}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40"
              >
                <span>
                  <span className="font-medium">{d.title}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {d.doc_id} · {d.folder}
                  </span>
                </span>
                <Badge variant="outline">{d.status}</Badge>
              </Link>
            ))}
            <Link
              href={`/documents/entities/${entity.entity_id}`}
              className="inline-flex text-sm underline-offset-4 hover:underline"
            >
              Full folder taxonomy →
            </Link>
          </div>
        )}
      </section>

      <section id="tickets" className="scroll-mt-24 space-y-4">
        <SectionHeading
          title="Shared Services tickets"
          description="Every subsidiary must use Tage SS — no shadow GL or side counsel."
        />
        {view.tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tickets linked.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Ticket</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Band</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.tickets.map((t) => (
                  <TableRow key={t.ticket_id}>
                    <TableCell>
                      <Link
                        href={`/shared-services/tickets/${t.ticket_id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {t.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {t.ticket_id}
                        {t.ai_generated ? ' · AI' : ''}
                      </div>
                    </TableCell>
                    <TableCell>{t.service}</TableCell>
                    <TableCell>{t.priority}</TableCell>
                    <TableCell>
                      <BandBadge band={t.autonomy_band} />
                    </TableCell>
                    <TableCell>{t.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="font-heading text-xl font-semibold tracking-tight text-[#3a414f]">
        {title}
      </h2>
      <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function Metric({
  label,
  value,
  core,
}: {
  label: string;
  value: string;
  core?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardDescription>{label}</CardDescription>
          {core ? <StandardBadge standard="CORE" /> : null}
        </div>
        <CardTitle className="font-heading text-2xl tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium text-foreground">{value}</dd>
    </div>
  );
}
