import Link from 'next/link';
import { StageSelect } from '@/components/deal-flow/stage-select';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate, formatUsdK } from '@/lib/format';
import type { Lead } from '@/lib/types';
import { PIPELINE_STAGES } from '@/lib/types';

export function PipelineTable({ leads }: { leads: Lead[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Company</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Next action</TableHead>
            <TableHead>Thesis</TableHead>
            <TableHead className="text-right">Check ($k)</TableHead>
            <TableHead>Priority</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => (
            <TableRow key={lead.lead_id}>
              <TableCell>
                <Link
                  href={`/deal-flow/vc/leads/${lead.lead_id}`}
                  className="font-medium text-[#3a414f] underline-offset-4 hover:underline"
                >
                  {lead.company_name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {lead.lead_id}
                  {lead.website ? ` · ${lead.website}` : ''}
                </div>
              </TableCell>
              <TableCell>
                <StageSelect leadId={lead.lead_id} stage={lead.stage} />
              </TableCell>
              <TableCell className="text-sm">{lead.owner ?? '—'}</TableCell>
              <TableCell className="max-w-[14rem]">
                <div className="truncate text-sm">{lead.next_action ?? '—'}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(lead.next_action_date)}
                </div>
              </TableCell>
              <TableCell className="text-sm">
                {lead.thesis_fit ?? '—'}
                {lead.score != null ? ` · ${lead.score}` : ''}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatUsdK(lead.check_size_k)}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="font-normal">
                  {lead.priority}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function PipelineStageSummary({ leads }: { leads: Lead[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {PIPELINE_STAGES.map((stage) => {
        const count = leads.filter((l) => l.stage === stage).length;
        return (
          <div
            key={stage}
            className="rounded-lg border border-border bg-card px-3 py-2"
          >
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              {stage}
            </p>
            <p className="font-heading text-xl font-semibold tabular-nums">
              {count}
            </p>
          </div>
        );
      })}
    </div>
  );
}
