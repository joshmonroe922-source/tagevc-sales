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
import { ViewModeLayout } from '@/components/ui/view-mode-toggle';
import { entityDisplayName } from '@/lib/entities/display-name';
import type { Entity, PortfolioCompany } from '@/lib/types';
import {
  VIEW_MODE_DEFAULTS,
  type ViewModeSurface,
} from '@/lib/view-mode';

export function AssetEntityList({
  entities,
  companies,
  emptyTitle,
  emptyDescription,
  surface = 'entities',
}: {
  entities: Entity[];
  companies: PortfolioCompany[];
  emptyTitle: string;
  emptyDescription: string;
  surface?: ViewModeSurface;
}) {
  const byEntity = new Map(companies.map((c) => [c.entity_id, c]));

  const cards = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entities.length === 0 ? (
        <div className="sm:col-span-2 lg:col-span-3">
          <EmptyState title={emptyTitle} description={emptyDescription} />
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
                    {e.industry_module ? e.industry_module : 'Asset'}
                    {e.coo_owner ? ` · Lead: ${e.coo_owner}` : ' · Unassigned'}
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
  );

  const list = (
    <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border">
      {entities.length === 0 ? (
        <div className="p-4">
          <EmptyState title={emptyTitle} description={emptyDescription} />
        </div>
      ) : (
        entities.map((e) => {
          const pf = byEntity.get(e.entity_id);
          const name = entityDisplayName(e);
          return (
            <Link
              key={e.entity_id}
              href={`/entities/${e.entity_id}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/40"
            >
              <div className="min-w-0">
                <p className="font-medium text-[#3a414f]">{name}</p>
                <p className="text-xs text-muted-foreground">
                  {e.entity_id}
                  {e.industry_module ? ` · ${e.industry_module}` : ''}
                  {` · ${e.entity_type}`}
                  {e.coo_owner ? ` · ${e.coo_owner}` : ' · Unassigned'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {pf ? <HealthBadge health={pf.health} /> : null}
                <span className="text-xs text-muted-foreground">Open →</span>
              </div>
            </Link>
          );
        })
      )}
    </div>
  );

  return (
    <ViewModeLayout
      surface={surface}
      defaultMode={VIEW_MODE_DEFAULTS[surface] ?? 'cards'}
      cards={cards}
      list={list}
    />
  );
}
