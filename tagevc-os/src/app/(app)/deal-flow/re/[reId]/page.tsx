import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ReStageSelect,
  ReTaskStatusSelect,
} from '@/components/deal-flow/re-actions';
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
import { getReDeal, listTasksForRe } from '@/lib/data/re-store';
import { formatDate, formatUsdK } from '@/lib/format';

type Props = { params: Promise<{ reId: string }> };

export default async function ReDetailPage({ params }: Props) {
  const { reId } = await params;
  const deal = getReDeal(reId);
  if (!deal) notFound();
  const tasks = listTasksForRe(deal.re_id);
  const open = tasks.filter((t) => t.status !== 'Completed');

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link
          href="/deal-flow/re"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← RE Pipeline
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
              {deal.asset_name}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{deal.re_id}</Badge>
              <Badge variant="secondary">{deal.route}</Badge>
              <Badge variant="outline">{deal.priority}</Badge>
              {deal.outcome ? (
                <Badge variant="outline">{deal.outcome}</Badge>
              ) : null}
              {deal.handoff_id ? (
                <Badge variant="secondary">Handoff {deal.handoff_id}</Badge>
              ) : null}
            </div>
          </div>
          <ReStageSelect reId={deal.re_id} stage={deal.stage} />
        </div>
        {deal.stage === 'Onboard' ? (
          <p className="text-xs text-muted-foreground">
            Onboard marks outcome Purchased and opens Portfolio Handoff (Ready
            for Portfolio / PFRE-*).
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">RE Pipeline fields</CardTitle>
            <CardDescription>From RE Pipeline Active.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Asset type" value={deal.asset_type ?? '—'} />
            <Row label="Market" value={deal.market ?? '—'} />
            <Row label="Source" value={deal.source ?? '—'} />
            <Row label="Sourcer" value={deal.sourcer ?? '—'} />
            <Row label="Ask ($k)" value={formatUsdK(deal.ask_k)} />
            <Row label="Offer ($k)" value={formatUsdK(deal.offer_k)} />
            <Row label="NOI / rent ($k/yr)" value={formatUsdK(deal.noi_k)} />
            <Row label="Cap / yield" value={deal.cap_yield_signal ?? '—'} />
            <Row label="Next action" value={deal.next_action ?? '—'} />
            <Row
              label="Next action date"
              value={formatDate(deal.next_action_date)}
            />
            <Separator />
            <Row label="Notes" value={deal.notes ?? '—'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">RE tasks</CardTitle>
            <CardDescription>
              {open.length} open · {tasks.length} total · Both + {deal.route}{' '}
              templates (once per RE-##).
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow key={t.task_id}>
                    <TableCell>
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.task_id}
                        {t.lib_id ? ` · ${t.lib_id}` : ''} · {t.priority}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{t.process_stage}</TableCell>
                    <TableCell>
                      <ReTaskStatusSelect
                        taskId={t.task_id}
                        reId={deal.re_id}
                        status={t.status}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-40 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium">{value}</dd>
    </div>
  );
}
