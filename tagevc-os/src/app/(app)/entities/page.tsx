import Link from 'next/link';
import { HealthBadge } from '@/components/portfolio/health-badge';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { listSubsidiaryEntities } from '@/lib/data/entity-os';
import { ensureMasterData, getMasterDataSource } from '@/lib/data/master-data';

export default async function EntitiesIndexPage() {
  const [entities, master] = await Promise.all([
    listSubsidiaryEntities(),
    ensureMasterData(),
  ]);
  const byEntity = new Map(master.companies.map((c) => [c.entity_id, c]));
  const source = getMasterDataSource();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
            Entities
          </h1>
          <Badge variant="outline" className="font-normal capitalize">
            {source === 'sql' ? 'Live DB' : source === 'seed+migrating' ? 'Migrating' : 'Seed'}
          </Badge>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Subsidiary Operating System hub — Entity Master rows with CORE KPIs,
          docs, tickets, leads, and tasks. Phase 53 adds Recruit 619 (ENT-R619)
          Subsidiary Rollup for open reqs / pipeline / placements.
        </p>
      </header>

      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Phase 53</Badge>
            <Badge variant="secondary">ENT-R619</Badge>
          </div>
          <CardTitle className="font-heading text-base">
            Recruit 619 Subsidiary Rollup
          </CardTitle>
          <CardDescription>
            Visionary / COO ops pulse for open reqs, pipeline volume,
            submissions, interviews, offers, placements, and freshness — with
            drill-downs to portal.recruit619.com.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/entities/ENT-R619#rollup"
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            Open Recruit 619 rollup →
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entities.length === 0 ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <EmptyState
              title="No entities in scope"
              description="No Entity Master rows are visible for your role / entity assignment."
            />
          </div>
        ) : (
          entities.map((e) => {
            const pf = byEntity.get(e.entity_id);
            return (
              <Link key={e.entity_id} href={`/entities/${e.entity_id}`}>
                <Card className="h-full transition-colors hover:border-[#3a414f]/35">
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{e.entity_id}</Badge>
                      {pf ? <HealthBadge health={pf.health} /> : null}
                    </div>
                    <CardTitle className="font-heading text-lg">
                      {e.canonical_name}
                    </CardTitle>
                    <CardDescription>
                      {e.entity_type}
                      {e.industry_module ? ` · ${e.industry_module}` : ''}
                      {pf ? ` · ${pf.portfolio_id}` : ''}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {e.entity_id === 'ENT-R619'
                      ? 'Rollup · Overview · CORE · FLEX · Leads · Tasks · Docs · SS'
                      : 'Overview · CORE · FLEX · Leads · Tasks · Docs · SS'}
                  </CardContent>
                </Card>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
