'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refreshSharedServicesInboxPhase54Action } from '@/app/(app)/shared-services/actions';
import { BandBadge } from '@/components/shared-services/band-badge';
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
import type {
  SharedServicesInboxPhase54Report,
  SsInboxRow,
  SsInboxSlaStatus,
} from '@/lib/shared-services/shared-services-inbox-phase54';
import {
  buildUnifiedInboxRows,
  slaStatusLabel,
} from '@/lib/shared-services/shared-services-inbox-phase54';
import type { SsService, Ticket } from '@/lib/types';
import { SS_SERVICES } from '@/lib/types';

const SLA_FILTERS: Array<SsInboxSlaStatus | 'All'> = [
  'All',
  'breached',
  'escalated',
  'due_soon',
  'ok',
  'none',
];

function slaBadgeVariant(
  status: SsInboxSlaStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'breached') return 'destructive';
  if (status === 'escalated') return 'destructive';
  if (status === 'due_soon') return 'secondary';
  return 'outline';
}

export function SsUnifiedInbox({
  tickets,
  report,
  initialService = 'All',
  initialEntityId = '',
}: {
  tickets: Ticket[];
  report: SharedServicesInboxPhase54Report;
  initialService?: SsService | 'All';
  initialEntityId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [service, setService] = useState<SsService | 'All'>(initialService);
  const [entityId, setEntityId] = useState(initialEntityId);
  const [sla, setSla] = useState<SsInboxSlaStatus | 'All'>('All');
  const [message, setMessage] = useState<string | null>(null);

  const rows: SsInboxRow[] = useMemo(
    () =>
      buildUnifiedInboxRows(tickets, report, {
        service,
        entityId: entityId.trim() || null,
        sla,
      }),
    [tickets, report, service, entityId, sla],
  );

  const board = report.by_sla_status;

  return (
    <section id="inbox" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
              Unified inbox
            </h2>
            <Badge variant="outline">Phase 54</Badge>
            <Badge variant="secondary">
              Feed · {report.feed_status}
            </Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Cross-service ticket board (Finance · Legal · HR · IT · Marketing)
            with SLA status, ownership, escalation visibility, and entity
            filters including {report.entity_filter_hint}. Dual-approve and
            money gates are never auto-approved.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await refreshSharedServicesInboxPhase54Action(
                entityId.trim() || null,
              );
              setMessage(
                res.ok
                  ? `Inbox refreshed · open ${res.report.open_total} · escalations ${res.report.escalated_count}`
                  : res.error,
              );
              router.refresh();
            })
          }
        >
          Refresh SLA board
        </Button>
      </div>

      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Open</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {report.open_total || rows.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Breached SLA</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {board.breached ?? report.breached_count}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Due soon</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {board.due_soon ?? report.due_soon_count}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Escalations / unassigned</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {report.escalated_count} / {report.unassigned_count}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Service</span>
          <select
            className="block h-9 min-w-[8rem] rounded-md border border-border bg-background px-2 text-sm"
            value={service}
            onChange={(e) =>
              setService(e.target.value as SsService | 'All')
            }
          >
            <option value="All">All services</option>
            {SS_SERVICES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Entity</span>
          <input
            className="block h-9 min-w-[10rem] rounded-md border border-border bg-background px-2 text-sm"
            placeholder={report.entity_filter_hint}
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            list="phase54-entity-hints"
          />
          <datalist id="phase54-entity-hints">
            <option value="ENT-R619" />
            <option value="ENT-001" />
            <option value="ENT-002" />
          </datalist>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">SLA</span>
          <select
            className="block h-9 min-w-[8rem] rounded-md border border-border bg-background px-2 text-sm"
            value={sla}
            onChange={(e) =>
              setSla(e.target.value as SsInboxSlaStatus | 'All')
            }
          >
            {SLA_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === 'All' ? 'All SLA' : slaStatusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => {
            setService('All');
            setEntityId('');
            setSla('All');
          }}
        >
          Clear filters
        </Button>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          onClick={() => setEntityId('ENT-R619')}
        >
          ENT-R619
        </Button>
      </div>

      {report.module_stubs.some((m) => m.todo) ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {report.module_stubs
            .filter((m) => m.todo)
            .map((m) => (
              <p key={m.service}>
                <span className="font-medium text-foreground">{m.service}:</span>{' '}
                {m.todo}{' '}
                <Link href={m.href} className="underline-offset-4 hover:underline">
                  Open filter
                </Link>
              </p>
            ))}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No matching tickets"
              description="Adjust service, entity, or SLA filters — or create a ticket below."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Ticket</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Entity / context</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Band</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.ticket.ticket_id}>
                  <TableCell>
                    <Link
                      href={`/shared-services/tickets/${row.ticket.ticket_id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.ticket.title}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{row.ticket.ticket_id}</span>
                      {row.escalated ? (
                        <Badge variant="destructive">Escalated</Badge>
                      ) : null}
                      {row.module_todo ? (
                        <Badge variant="outline">Module stub</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.module_href ? (
                      <Link
                        href={row.module_href}
                        className="underline-offset-4 hover:underline"
                      >
                        {row.ticket.service}
                      </Link>
                    ) : (
                      row.ticket.service
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={slaBadgeVariant(row.sla_status)}>
                      {slaStatusLabel(row.sla_status)}
                    </Badge>
                    {row.ticket.sla_due_at ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Due {row.ticket.sla_due_at.slice(0, 10)}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.owner}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {row.related
                        .filter((l) => l.kind !== 'ticket')
                        .slice(0, 3)
                        .map((l) => (
                          <Link
                            key={`${l.kind}-${l.href}`}
                            href={l.href}
                            className="text-xs underline-offset-4 hover:underline"
                          >
                            {l.label}
                          </Link>
                        ))}
                      {!row.ticket.entity_id && !row.ticket.company_name ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{row.ticket.priority}</Badge>
                  </TableCell>
                  <TableCell>
                    <BandBadge band={row.ticket.autonomy_band} />
                  </TableCell>
                  <TableCell>{row.ticket.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {report.recent_escalations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent escalations</CardTitle>
            <CardDescription>
              Append-only Phase 54 SLA / ownership escalation evidence
              (visibility only).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {report.recent_escalations.slice(0, 8).map((e) => (
              <div
                key={`${e.ticket_id}-${e.created_at}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <div className="space-y-0.5">
                  <Link
                    href={`/shared-services/tickets/${e.ticket_id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {e.ticket_id}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {e.service}
                    {e.entity_id ? ` · ${e.entity_id}` : ''}
                    {e.owner_name ? ` · owner ${e.owner_name}` : ' · unassigned'}
                  </p>
                </div>
                <Badge
                  variant={
                    e.severity === 'critical' ? 'destructive' : 'secondary'
                  }
                >
                  {e.sla_status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
