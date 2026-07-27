import { AssetEntityList } from '@/components/portfolio/asset-entity-list';
import { listAssetPortfolioEntities } from '@/lib/data/entity-os';
import { ensureMasterData } from '@/lib/data/master-data';

export default async function RealEstateAssetsPage() {
  const [entities, master] = await Promise.all([
    listAssetPortfolioEntities('real_estate'),
    ensureMasterData(),
  ]);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Real Estate
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          RE asset entities you are assigned to lead. Sample Indy SFR and other
          demo rows stay filtered out.
        </p>
      </header>

      <AssetEntityList
        entities={entities}
        companies={master.companies}
        emptyTitle="No real estate in scope"
        emptyDescription="No RE assets are assigned to you yet."
        surface="entities"
      />
    </div>
  );
}
