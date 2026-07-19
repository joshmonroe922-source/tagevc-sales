import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  DealExecStageSelect,
  DealTaskStatusSelect,
  SubmitIcButton,
} from '@/components/deal-flow/deal-actions';
import { IcDecisionForm } from '@/components/deal-flow/ic-decision-form';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getDeal,
  getHandoff,
  getIcForDeal,
  getLead,
  listIcAuditsForDeal,
  listTasksForDeal,
} from '@/lib/data/deal-flow-store';
import { formatUsdK } from '@/lib/format';

type Props = { params: Promise<{ dealId: string }> };

export default async function DealDetailPage({ params }: Props) {
  const { dealId } = await params;
  const deal = getDeal(dealId);
  if (!deal) notFound();
  const lead = deal.lead_id ? getLead(deal.lead_id) : null;
  const tasks = listTasksForDeal(deal.deal_id);
  const open = tasks.filter((t) => t.status !== 'Completed');
  const ic = getIcForDeal(deal.deal_id);
  const audits = listIcAuditsForDeal(deal.deal_id);
  const handoff = deal.handoff_id ? getHandoff(deal.handoff_id) : null;
  const needsIc =
    deal.exec_stage === 'IC Approved' &&
    (!ic ||
      ic.status !== 'Decided' ||
      (ic.decision !== 'Approve' && ic.decision !== 'Approve with conditions'));

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <Link href="/deal-flow/vc/deals" className="hover:text-foreground">
            ← Deal Active
          </Link>
          <Link href="/deal-flow/vc" className="hover:text-foreground">
            Pipeline
          </Link>
          <Link href="/deal-flow/vc/ic" className="hover:text-foreground">
            IC queue
          </Link>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
              {deal.company_name}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{deal.deal_id}</Badge>
              <Badge variant="secondary">{deal.priority}</Badge>
              {deal.outcome ? (
                <Badge variant="outline">{deal.outcome}</Badge>
              ) : null}
              {handoff ? (
                <Badge variant="secondary">
                  Handoff {handoff.handoff_id} · {handoff.status}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DealExecStageSelect dealId={deal.deal_id} stage={deal.exec_stage} />
            {deal.exec_stage === 'IC Approved' && needsIc ? (
              <SubmitIcButton dealId={deal.deal_id} />
            ) : null}
          </div>
        </div>
        {needsIc ? (
          <p className="text-xs text-muted-foreground">
            IC must Approve before advancing past IC Approved (human gate).
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deal Active</CardTitle>
            <CardDescription>
              IC → term sheet → confirmatory DD → docs → wire → Post-Close.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <Row label="Lead" value={deal.lead_id ?? '—'} />
            <Row label="Owner" value={deal.owner ?? '—'} />
            <Row label="Counsel" value={deal.counsel ?? '—'} />
            <Row label="Instrument" value={deal.instrument ?? '—'} />
            <Row label="Check ($k)" value={formatUsdK(deal.check_k)} />
            <Row
              label="Pre-money ($m)"
              value={deal.premoney_m != null ? String(deal.premoney_m) : '—'}
            />
            <Row
              label="Target own %"
              value={
                deal.ownership_pct != null
                  ? `${(deal.ownership_pct * 100).toFixed(1)}%`
                  : '—'
              }
            />
            <Row label="Next action" value={deal.next_action ?? '—'} />
            {lead ? (
              <div className="sm:col-span-2 pt-2">
                <Link
                  href={`/deal-flow/vc/leads/${lead.lead_id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  View linked lead {lead.lead_id} →
                </Link>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Investment Committee</CardTitle>
            <CardDescription>
              {ic
                ? `${ic.ic_id} · ${ic.status}${ic.decision ? ` · ${ic.decision}` : ''}`
                : 'No IC review yet — convert from Ready for DD or submit.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {ic?.conditions ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Conditions: </span>
                {ic.conditions}
              </p>
            ) : null}
            {ic && ic.status !== 'Decided' ? (
              <IcDecisionForm icId={ic.ic_id} />
            ) : null}
            {audits.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {audits.map((a) => (
                  <li
                    key={a.event_id}
                    className="rounded-md border border-border px-3 py-2"
                  >
                    <div className="font-medium">
                      {a.action}
                      {a.decision ? ` · ${a.decision}` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.event_id} · {a.actor} · {a.created_at.slice(0, 10)}
                    </div>
                    <div className="mt-1 text-muted-foreground">{a.detail}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No IC audit events.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deal tasks</CardTitle>
          <CardDescription>
            {open.length} open · {tasks.length} total · Deal Process Library
            (once per DX-##).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Owner</TableHead>
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
                  <TableCell className="text-sm">{t.owner ?? '—'}</TableCell>
                  <TableCell>
                    <DealTaskStatusSelect
                      taskId={t.task_id}
                      dealId={deal.deal_id}
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
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
