import Link from 'next/link';
import { DealFlowTrackTabs } from '@/components/deal-flow/deal-flow-track-tabs';
import { ReStageSelect } from '@/components/deal-flow/re-actions';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listScopedActiveReDeals } from '@/lib/data/pipeline-scope';
import { isReAssignmentScopedRole } from '@/lib/deal-flow/re/assignment';
import { formatDate, formatUsdK } from '@/lib/format';
import { getSessionContext } from '@/lib/rbac/session';
import { RE_STAGES } from '@/lib/types';

export default async function RePipelinePage() {
  const [deals, session] = await Promise.all([
    listScopedActiveReDeals(),
    getSessionContext(),
  ]);
  const sourcerDesk = Boolean(
    session?.profile.role && isReAssignmentScopedRole(session.profile.role),
  );
  const resi = deals.filter((d) => d.route === 'Residential').length;
  const cre = deals.filter((d) => d.route === 'Commercial').length;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        {sourcerDesk ? null : (
          <Link
            href="/deal-flow"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Deal Flow
          </Link>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
              {sourcerDesk ? 'Sourcing Platform' : 'Real estate deals'}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {sourcerDesk
                ? 'RE leads assigned to you from sourced through completion and handoff.'
                : 'Residential and commercial assets from screen through close.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{deals.length} active</Badge>
            <Badge variant="outline">{resi} Residential</Badge>
            <Badge variant="outline">{cre} Commercial</Badge>
            {sourcerDesk ? null : (
              <Link
                href="/deal-flow/vc/intake"
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                Lead Intake →
              </Link>
            )}
          </div>
        </div>
        {sourcerDesk ? null : <DealFlowTrackTabs active="re" />}
      </header>

      <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {RE_STAGES.map((stage) => {
          const count = deals.filter((d) => d.stage === stage).length;
          return (
            <div
              key={stage}
              className="rounded-lg border border-border bg-card px-3 py-2"
            >
              <p className="truncate text-[10px] tracking-wide text-muted-foreground uppercase">
                {stage}
              </p>
              <p className="font-heading text-xl font-semibold tabular-nums">
                {count}
              </p>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Asset</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Sourcer</TableHead>
              <TableHead>Next action</TableHead>
              <TableHead className="text-right">Ask ($k)</TableHead>
              <TableHead>Priority</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deals.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {sourcerDesk
                    ? 'No RE leads assigned to you right now. Active assignments appear here through handoff.'
                    : (
                      <>
                        No active RE assets. New assets go through{' '}
                        <Link
                          href="/deal-flow/vc/intake"
                          className="font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          Lead Intake
                        </Link>
                        .
                      </>
                    )}
                </TableCell>
              </TableRow>
            ) : (
              deals.map((d) => (
                <TableRow key={d.re_id}>
                  <TableCell>
                    <Link
                      href={`/deal-flow/re/${d.re_id}`}
                      className="font-medium text-[#3a414f] underline-offset-4 hover:underline"
                    >
                      {d.asset_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {d.re_id}
                      {d.market ? ` · ${d.market}` : ''}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-normal">
                      {d.route}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <ReStageSelect reId={d.re_id} stage={d.stage} />
                  </TableCell>
                  <TableCell className="text-sm">{d.sourcer ?? '—'}</TableCell>
                  <TableCell className="max-w-[14rem]">
                    <div className="truncate text-sm">{d.next_action ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(d.next_action_date)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsdK(d.ask_k)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-normal">
                      {d.priority}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {sourcerDesk ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            Have a new RE asset to add?
          </span>
          <Link
            href="/deal-flow/vc/intake"
            className="font-medium underline-offset-4 hover:underline"
          >
            Add via Lead Intake →
          </Link>
        </div>
      )}
    </div>
  );
}
