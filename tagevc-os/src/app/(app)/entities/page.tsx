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
import { listSubsidiaryEntities } from '@/lib/data/entity-os';
import { SEED_PORTFOLIO_COMPANIES } from '@/lib/data/seed';

export default async function EntitiesIndexPage() {
  const entities = await listSubsidiaryEntities();
  const byEntity = new Map(
    SEED_PORTFOLIO_COMPANIES.map((c) => [c.entity_id, c]),
  );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Entities
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Subsidiary Operating System hub — Entity Master rows with CORE KPIs,
          docs, tickets, leads, and tasks. Demo: Instant NDA (ENT-002).
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entities.map((e) => {
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
                  Overview · CORE · FLEX · Leads · Tasks · Docs · SS
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
