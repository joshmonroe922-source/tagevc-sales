import {
  SEED_ENTITIES,
  SEED_ENTITY_MONTH_PNL,
  SEED_PERIOD,
  SEED_PORTFOLIO_COMPANIES,
} from '@/lib/data/seed';
import {
  SEED_ENTITY_MONTH_KPI,
  SEED_ENTITY_MONTH_KPI_FLEX,
} from '@/lib/data/entity-kpi-seed';
import { fetchAllEntities, syncEntities } from '@/lib/data/normalized/entities-repo';
import {
  fetchAllEntityMonthKpiFlex,
  fetchAllEntityMonthKpis,
  fetchAllEntityMonthPnl,
  fetchAllPortfolioCompanies,
  syncPortfolioMaster,
} from '@/lib/data/normalized/portfolio-repo';
import {
  queueNormalizedSync,
  shouldUseNormalizedRows,
} from '@/lib/data/normalized/sync';
import type {
  Entity,
  EntityMonthKpi,
  EntityMonthKpiFlex,
  EntityMonthPnl,
  PortfolioCompany,
} from '@/lib/types';

type MasterDataCache = {
  entities: Entity[];
  companies: PortfolioCompany[];
  pnl: EntityMonthPnl[];
  coreKpis: EntityMonthKpi[];
  flexKpis: EntityMonthKpiFlex[];
  period: string;
  source: 'seed' | 'sql' | 'seed+migrating';
  hydrated: boolean;
  hydrateError: string | null;
};

declare global {
  var __tageMasterData: MasterDataCache | undefined;
}

function createFromSeed(): MasterDataCache {
  return {
    entities: [...SEED_ENTITIES],
    companies: [...SEED_PORTFOLIO_COMPANIES],
    pnl: [...SEED_ENTITY_MONTH_PNL],
    coreKpis: [...SEED_ENTITY_MONTH_KPI],
    flexKpis: [...SEED_ENTITY_MONTH_KPI_FLEX],
    period: SEED_PERIOD,
    source: 'seed',
    hydrated: false,
    hydrateError: null,
  };
}

function getCache(): MasterDataCache {
  if (!globalThis.__tageMasterData) {
    globalThis.__tageMasterData = createFromSeed();
  }
  return globalThis.__tageMasterData;
}

/**
 * Hydrate Entity Master + Portfolio Active (+ P&L / KPIs) from SQL when ready.
 * Falls back to seed; one-shot migrates seed → SQL when tables exist but empty.
 */
export async function hydrateMasterData(): Promise<void> {
  const cache = getCache();
  if (cache.hydrated) return;

  try {
    const [sqlEntities, sqlCompanies, sqlPnl, sqlKpis, sqlFlex] =
      await Promise.all([
        fetchAllEntities(),
        fetchAllPortfolioCompanies(),
        fetchAllEntityMonthPnl(),
        fetchAllEntityMonthKpis(),
        fetchAllEntityMonthKpiFlex(),
      ]);

    let usedSql = false;
    let needsMigrate = false;

    if (shouldUseNormalizedRows(sqlEntities)) {
      if (sqlEntities.length > 0) {
        cache.entities = sqlEntities;
        usedSql = true;
      }
    } else if (sqlEntities !== null && cache.entities.length > 0) {
      needsMigrate = true;
    }

    if (shouldUseNormalizedRows(sqlCompanies)) {
      if (sqlCompanies.length > 0) {
        cache.companies = sqlCompanies;
        usedSql = true;
      }
    } else if (sqlCompanies !== null && cache.companies.length > 0) {
      needsMigrate = true;
    }

    if (shouldUseNormalizedRows(sqlPnl) && sqlPnl.length > 0) {
      cache.pnl = sqlPnl;
      usedSql = true;
      const periods = [...new Set(sqlPnl.map((r) => r.period))].sort();
      if (periods.length > 0) {
        cache.period = periods[periods.length - 1]!;
      }
    }

    if (shouldUseNormalizedRows(sqlKpis) && sqlKpis.length > 0) {
      cache.coreKpis = sqlKpis;
      usedSql = true;
    }

    if (shouldUseNormalizedRows(sqlFlex) && sqlFlex.length > 0) {
      cache.flexKpis = sqlFlex;
      usedSql = true;
    }

    if (needsMigrate) {
      cache.source = 'seed+migrating';
      // Entities first — portfolio_companies FKs entity_id
      queueNormalizedSync('master_data', async () => {
        const okEntities = await syncEntities(cache.entities);
        if (!okEntities) return false;
        return syncPortfolioMaster({
          companies: cache.companies,
          pnl: cache.pnl,
          coreKpis: cache.coreKpis,
          flexKpis: cache.flexKpis,
        });
      });
    } else if (usedSql) {
      cache.source = 'sql';
    }
  } catch (e) {
    cache.hydrateError =
      e instanceof Error ? e.message : 'master data hydrate failed';
    console.error('hydrateMasterData', e);
  }

  cache.hydrated = true;
}

export async function ensureMasterData(): Promise<MasterDataCache> {
  await hydrateMasterData();
  return getCache();
}

export function getMasterDataSource(): MasterDataCache['source'] {
  return getCache().source;
}

export function getMasterDataHydrateError(): string | null {
  return getCache().hydrateError;
}

/** Sync read — prefers hydrated cache, else seed (mutations after bootstrap). */
export function listEntitiesSync(): Entity[] {
  const cache = getCache();
  if (cache.hydrated) return cache.entities;
  return [...SEED_ENTITIES];
}

export function getEntitySync(entityId: string): Entity | null {
  return (
    listEntitiesSync().find((e) => e.entity_id === entityId) ?? null
  );
}

/** Test / local reset helper. */
export function resetMasterDataCache() {
  globalThis.__tageMasterData = createFromSeed();
}
