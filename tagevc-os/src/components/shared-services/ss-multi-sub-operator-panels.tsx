import { buildSsOperatorBoard } from '@/lib/multi-sub/ss-operator';
import type { MultiSubHealthReport } from '@/lib/multi-sub/health';
import type { Ticket } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function SsMultiSubOperatorPanels({
  tickets,
  health,
}: {
  tickets: Ticket[];
  health: MultiSubHealthReport;
}) {
  const board = buildSsOperatorBoard(tickets);
  const volumeEntries = Object.entries(health.ticket_volume_by_entity);
  const slaEntries = Object.entries(health.ticket_sla_by_entity);

  return (
    <section id="multi-sub" className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            Multi-subsidiary operator board
          </h2>
          <Badge variant="outline">P4 · P6</Badge>
          <Badge variant="secondary">Feed · {health.feed_status}</Badge>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Views by service line, entity, and priority. Parent vs subsidiary
          open counts. Health panels for ticket SLA, messaging provision
          failures, and identity lifecycle — money never auto-approved.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{board.context_labels.parent}</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {board.parent_open}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Subsidiary open</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {board.subsidiary_open}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Messaging provision failures</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {health.messaging_provision_failures}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Lifecycle ok / fail</CardDescription>
            <CardTitle className="font-heading text-2xl tabular-nums">
              {health.lifecycle_success} / {health.lifecycle_failure}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By service</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {Object.entries(board.by_service).length === 0 ? (
              <p className="text-muted-foreground">No open tickets</p>
            ) : (
              Object.entries(board.by_service).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span>{k}</span>
                  <span className="tabular-nums">{v}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By entity</CardTitle>
            <CardDescription>
              {board.context_labels.subsidiary_r619} ·{' '}
              {board.context_labels.subsidiary_inda}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {volumeEntries.length === 0 ? (
              <p className="text-muted-foreground">No open tickets</p>
            ) : (
              volumeEntries.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span>{k}</span>
                  <span className="tabular-nums">{v}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SLA by entity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {slaEntries.length === 0 ? (
              <p className="text-muted-foreground">No SLA rows</p>
            ) : (
              slaEntries.map(([k, v]) => (
                <div key={k} className="rounded-md border border-border px-2 py-1.5">
                  <div className="font-medium">{k}</div>
                  <div className="text-xs text-muted-foreground">
                    open {v.open} · breached {v.breached} · P0 {v.p0}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {health.todo ? (
        <p className="text-xs text-muted-foreground">{health.todo}</p>
      ) : null}
    </section>
  );
}
