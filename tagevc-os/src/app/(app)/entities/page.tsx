import { AssetEntityList } from '@/components/portfolio/asset-entity-list';
import { listAssetPortfolioEntities } from '@/lib/data/entity-os';
import { ensureMasterData } from '@/lib/data/master-data';

export default async function BusinessesIndexPage() {
  const [entities, master] = await Promise.all([
    listAssetPortfolioEntities('business'),
    ensureMasterData(),
  ]);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Businesses
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Operating companies in your lead scope. Sample and unassigned entities
          stay hidden for COO and subsidiary leaders.
        </p>
      </header>

      <AssetEntityList
        entities={entities}
        companies={master.companies}
        emptyTitle="No businesses in scope"
        emptyDescription="No operating companies are assigned to you yet."
        surface="entities"
      />
    </div>
  );
}
