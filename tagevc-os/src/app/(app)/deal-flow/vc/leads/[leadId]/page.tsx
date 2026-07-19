import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ConvertToDealButton,
  TaskStatusSelect,
} from '@/components/deal-flow/lead-actions';
import { StageSelect } from '@/components/deal-flow/stage-select';
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
import { getLead, listTasksForLead } from '@/lib/data/deal-flow-store';
import { isReadyForDealConversion } from '@/lib/deal-flow/stage';
import { formatDate, formatUsdK } from '@/lib/format';

type Props = { params: Promise<{ leadId: string }> };

export default async function LeadDetailPage({ params }: Props) {
  const { leadId } = await params;
  const lead = getLead(leadId);
  if (!lead) notFound();
  const tasks = listTasksForLead(lead.lead_id);
  const open = tasks.filter((t) => t.status !== 'Completed');

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <Link href="/deal-flow/vc" className="hover:text-foreground">
            ← Pipeline Active
          </Link>
          {lead.deal_id ? (
            <>
              <span>·</span>
              <Link
                href={`/deal-flow/vc/deals/${lead.deal_id}`}
                className="hover:text-foreground"
              >
                {lead.deal_id}
              </Link>
              <span>·</span>
              <Link href="/deal-flow/vc/ic" className="hover:text-foreground">
                IC
              </Link>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
              {lead.company_name}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{lead.lead_id}</Badge>
              <Badge variant="secondary">{lead.priority}</Badge>
              {lead.thesis_fit ? (
                <Badge variant="secondary">{lead.thesis_fit}</Badge>
              ) : null}
              {lead.outcome ? (
                <Badge variant="outline">{lead.outcome}</Badge>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StageSelect leadId={lead.lead_id} stage={lead.stage} />
            <ConvertToDealButton
              leadId={lead.lead_id}
              disabled={!isReadyForDealConversion(lead.stage)}
              existingDealId={lead.deal_id}
            />
          </div>
        </div>
        {!isReadyForDealConversion(lead.stage) && !lead.deal_id ? (
          <p className="text-xs text-muted-foreground">
            Move to Ready for DD to open a Deal Active record.
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline fields</CardTitle>
            <CardDescription>From Pipeline Active.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Website" value={lead.website ?? '—'} />
            <Row label="Sector" value={lead.sector ?? '—'} />
            <Row label="Source" value={lead.source ?? '—'} />
            <Row label="Source detail" value={lead.source_detail ?? '—'} />
            <Row label="Owner" value={lead.owner ?? '—'} />
            <Row label="Next action" value={lead.next_action ?? '—'} />
            <Row label="Next action date" value={formatDate(lead.next_action_date)} />
            <Row label="Raise stage" value={lead.raise_stage ?? '—'} />
            <Row label="Check ($k)" value={formatUsdK(lead.check_size_k)} />
            <Row label="Location" value={lead.location ?? '—'} />
            <Row
              label="Score"
              value={lead.score != null ? String(lead.score) : '—'}
            />
            <Separator />
            <Row label="Notes" value={lead.notes ?? '—'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead tasks</CardTitle>
            <CardDescription>
              {open.length} open · {tasks.length} total · spawned from Lead
              Process Library (once per LS-##).
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
                      <TaskStatusSelect
                        taskId={t.task_id}
                        leadId={lead.lead_id}
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
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium">{value}</dd>
    </div>
  );
}
