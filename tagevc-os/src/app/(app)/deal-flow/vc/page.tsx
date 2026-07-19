import Link from 'next/link';
import { CreateLeadForm } from '@/components/deal-flow/create-lead-form';
import {
  PipelineStageSummary,
  PipelineTable,
} from '@/components/deal-flow/pipeline-table';
import { Badge } from '@/components/ui/badge';
import {
  listActiveDeals,
  listActiveLeads,
  listOpenLeadTasks,
} from '@/lib/data/deal-flow-store';

export default async function VcDealFlowPage() {
  const leads = listActiveLeads();
  const openTasks = listOpenLeadTasks();
  const deals = listActiveDeals();
  const ready = leads.filter((l) => l.stage === 'Ready for DD').length;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <Link
          href="/deal-flow"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Deal Flow hub
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
              Deal Flow · VC
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Pipeline Active — one row per company. Stage moves spawn Lead
              Process Library tasks once per template.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{leads.length} active leads</Badge>
            <Badge variant="outline">{ready} ready for DD</Badge>
            <Badge variant="outline">{openTasks.length} open tasks</Badge>
            <Link
              href="/deal-flow/vc/intake"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              Lead intake →
            </Link>
            <Link
              href="/deal-flow/vc/deals"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              Deal Active ({deals.length}) →
            </Link>
            <Link
              href="/deal-flow/vc/ic"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              IC queue →
            </Link>
          </div>
        </div>
      </header>

      <PipelineStageSummary leads={leads} />
      <PipelineTable leads={leads} />
      <CreateLeadForm />
    </div>
  );
}
