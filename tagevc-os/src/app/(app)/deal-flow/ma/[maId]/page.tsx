import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  MaStageSelect,
  MaTaskStatusSelect,
} from '@/components/deal-flow/ma-actions';
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
import { getMaTarget, listTasksForMa } from '@/lib/data/ma-store';
import { formatDate } from '@/lib/format';

type Props = { params: Promise<{ maId: string }> };

export default async function MaDetailPage({ params }: Props) {
  const { maId } = await params;
  const target = getMaTarget(maId);
  if (!target) notFound();
  const tasks = listTasksForMa(target.ma_id);
  const open = tasks.filter((t) => t.status !== 'Completed');

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link
          href="/deal-flow/ma"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← M&A Pipeline
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
              {target.company_name}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{target.ma_id}</Badge>
              <Badge variant="secondary">{target.priority}</Badge>
              {target.deal_type ? (
                <Badge variant="outline">{target.deal_type}</Badge>
              ) : null}
              {target.outcome ? (
                <Badge variant="outline">{target.outcome}</Badge>
              ) : null}
              {target.handoff_id ? (
                <Badge variant="secondary">Handoff {target.handoff_id}</Badge>
              ) : null}
            </div>
          </div>
          <MaStageSelect maId={target.ma_id} stage={target.stage} />
        </div>
        {target.stage === 'Integration' ? (
          <p className="text-xs text-muted-foreground">
            Integration stage marks outcome Acquired and opens Portfolio Handoff
            (Ready for Portfolio).
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">M&A Pipeline fields</CardTitle>
            <CardDescription>From M&A Pipeline Active.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Website" value={target.website ?? '—'} />
            <Row label="Sector" value={target.sector ?? '—'} />
            <Row label="Source" value={target.source ?? '—'} />
            <Row label="Owner" value={target.owner ?? '—'} />
            <Row label="Strategic fit" value={target.strategic_fit ?? '—'} />
            <Row
              label="EV / Rev / EBITDA ($m)"
              value={[
                target.enterprise_value_m,
                target.revenue_m,
                target.ebitda_m,
              ]
                .map((n) => (n != null ? String(n) : '—'))
                .join(' / ')}
            />
            <Row label="Exclusivity end" value={formatDate(target.exclusivity_end)} />
            <Row label="Next action" value={target.next_action ?? '—'} />
            <Row
              label="Next action date"
              value={formatDate(target.next_action_date)}
            />
            <Separator />
            <Row label="Notes" value={target.notes ?? '—'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">M&A tasks</CardTitle>
            <CardDescription>
              {open.length} open · {tasks.length} total · spawned from M&A
              Process Library (once per MA-##).
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
                      <MaTaskStatusSelect
                        taskId={t.task_id}
                        maId={target.ma_id}
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
