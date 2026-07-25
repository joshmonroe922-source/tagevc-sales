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
import { ensureMasterData } from '@/lib/data/master-data';
import { entityDisplayName } from '@/lib/entities/display-name';

export default async function EntitiesIndexPage() {
  const [entities, master] = await Promise.all([
    listSubsidiaryEntities(),
    ensureMasterData(),
  ]);
  const byEntity = new Map(master.companies.map((c) => [c.entity_id, c]));

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Portfolio companies
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Open a company to see its performance summary, service work, documents,
          and operating details.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entities.length === 0 ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <EmptyState
              title="No companies in scope"
              description="No companies are visible for your role or assignment yet."
            />
          </div>
        ) : (
          entities.map((e) => {
            const pf = byEntity.get(e.entity_id);
            const name = entityDisplayName(e);
            return (
              <Link key={e.entity_id} href={`/entities/${e.entity_id}`}>
                <Card className="h-full transition-colors hover:border-[#3a414f]/35">
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {pf ? <HealthBadge health={pf.health} /> : null}
                      <Badge variant="secondary" className="font-normal">
                        {e.entity_type}
                      </Badge>
                    </div>
                    <CardTitle className="font-heading text-lg">{name}</CardTitle>
                    <CardDescription>
                      {e.industry_module ? e.industry_module : 'Company'}
                      {e.entity_id === 'ENT-R619'
                        ? ' · includes performance rollup'
                        : ''}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    Overview · KPIs · tasks · documents · service tickets
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
