import Link from 'next/link';
import { DealFlowTrackTabs } from '@/components/deal-flow/deal-flow-track-tabs';
import { CreateMaTargetForm, MaStageSelect } from '@/components/deal-flow/ma-actions';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listScopedActiveMaTargets } from '@/lib/data/pipeline-scope';
import { formatDate } from '@/lib/format';
import { MA_STAGES } from '@/lib/types';

export default async function MaPipelinePage() {
  const targets = await listScopedActiveMaTargets();
  const exclusivity = targets.filter((t) => t.stage === 'LOI / Exclusivity').length;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <Link
          href="/deal-flow"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Deal Flow
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
              M&A deals
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Platform, add-on, and merger targets from sourcing through close.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{targets.length} active</Badge>
            <Badge variant="outline">{exclusivity} in exclusivity</Badge>
          </div>
        </div>
        <DealFlowTrackTabs active="ma" />
      </header>

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
        {MA_STAGES.map((stage) => {
          const count = targets.filter((t) => t.stage === stage).length;
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
              <TableHead>Target</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Next action</TableHead>
              <TableHead className="text-right">EV ($m)</TableHead>
              <TableHead>Priority</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {targets.map((t) => (
              <TableRow key={t.ma_id}>
                <TableCell>
                  <Link
                    href={`/deal-flow/ma/${t.ma_id}`}
                    className="font-medium text-[#3a414f] underline-offset-4 hover:underline"
                  >
                    {t.company_name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {t.ma_id}
                    {t.sector ? ` · ${t.sector}` : ''}
                  </div>
                </TableCell>
                <TableCell>
                  <MaStageSelect maId={t.ma_id} stage={t.stage} />
                </TableCell>
                <TableCell className="text-sm">{t.deal_type ?? '—'}</TableCell>
                <TableCell className="text-sm">{t.owner ?? '—'}</TableCell>
                <TableCell className="max-w-[14rem]">
                  <div className="truncate text-sm">{t.next_action ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(t.next_action_date)}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {t.enterprise_value_m != null ? t.enterprise_value_m : '—'}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-normal">
                    {t.priority}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <CreateMaTargetForm />
    </div>
  );
}
