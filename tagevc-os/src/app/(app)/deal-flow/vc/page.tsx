import Link from 'next/link';
import { CreateLeadForm } from '@/components/deal-flow/create-lead-form';
import { DealFlowTrackTabs } from '@/components/deal-flow/deal-flow-track-tabs';
import {
  PipelineStageSummary,
  PipelineTable,
} from '@/components/deal-flow/pipeline-table';
import { Badge } from '@/components/ui/badge';
import {
  listScopedActiveDeals,
  listScopedActiveLeads,
  listScopedOpenLeadTasks,
} from '@/lib/data/pipeline-scope';

export default async function VcDealFlowPage() {
  const [leads, openTasks, deals] = await Promise.all([
    listScopedActiveLeads(),
    listScopedOpenLeadTasks(),
    listScopedActiveDeals(),
  ]);
  const ready = leads.filter((l) => l.stage === 'Ready for DD').length;

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
              Venture deals
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Active leads and deals — move stages to spawn process tasks.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{leads.length} active leads</Badge>
            <Badge variant="outline">{ready} ready for diligence</Badge>
            <Badge variant="outline">{openTasks.length} open tasks</Badge>
            <Link
              href="/deal-flow/vc/intake"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              Lead Intake →
            </Link>
            <Link
              href="/deal-flow/vc/deals"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              View deals ({deals.length}) →
            </Link>
            <Link
              href="/deal-flow/vc/ic"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              IC queue →
            </Link>
          </div>
        </div>
        <DealFlowTrackTabs active="vc" />
      </header>

      <PipelineStageSummary leads={leads} />
      <PipelineTable leads={leads} />
      <CreateLeadForm />
    </div>
  );
}
