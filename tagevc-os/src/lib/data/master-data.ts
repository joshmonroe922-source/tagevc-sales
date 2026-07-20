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
import {
  fetchAllEntities,
  syncEntities,
  updateEntityFields,
} from '@/lib/data/normalized/entities-repo';
import {
  fetchAllEntityMonthKpiFlex,
  fetchAllEntityMonthKpis,
  fetchAllEntityMonthPnl,
  fetchAllPortfolioCompanies,
  syncPortfolioMaster,
  updatePortfolioCompanyFields,
} from '@/lib/data/normalized/portfolio-repo';
import {
  queueNormalizedSync,
  recordNormalizedSyncResult,
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

export async function patchPortfolioCompany(
  portfolioId: string,
  patch: Partial<
    Pick<
      PortfolioCompany,
      | 'health'
      | 'top_risk'
      | 'next_milestone'
      | 'notes'
      | 'coo_owner'
      | 'board_lead'
      | 'arr_k'
      | 'mom_growth'
      | 'net_burn_k'
      | 'runway_mo'
      | 'cash_k'
    >
  >,
): Promise<PortfolioCompany> {
  await ensureMasterData();
  const cache = getCache();
  const idx = cache.companies.findIndex((c) => c.portfolio_id === portfolioId);
  if (idx < 0) throw new Error(`Unknown portfolio ${portfolioId}`);

  const current = cache.companies[idx]!;
  let updated = await updatePortfolioCompanyFields(portfolioId, patch);
  if (!updated) {
    const next: PortfolioCompany = {
      ...current,
      ...patch,
      last_update: new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    };
    const { syncPortfolioCompanies } = await import(
      '@/lib/data/normalized/portfolio-repo'
    );
    const ok = await syncPortfolioCompanies([next]);
    if (!ok) {
      throw new Error(
        'Could not save portfolio changes — apply Phase 14 SQL and confirm Live DB.',
      );
    }
    updated = next;
  }

  cache.companies[idx] = updated;
  cache.source = 'sql';
  recordNormalizedSyncResult('portfolio_company_patch', true);
  return updated;
}

export type CoreFinancialPatch = {
  arr_k: number;
  net_burn_k: number;
  cash_k: number;
  runway_mo: number | null;
  mom_growth: number | null;
  cogs_k?: number;
  opex_k?: number;
};

/**
 * Update Portfolio CORE $ fields and keep same-period entity_month_pnl aligned
 * so Portfolio Roll-up SUM/WEIGHTED/MIN stay consistent.
 */
export async function patchPortfolioCoreFinancials(
  portfolioId: string,
  patch: CoreFinancialPatch,
  opts?: {
    actorId?: string | null;
    actorEmail?: string | null;
  },
): Promise<{ company: PortfolioCompany; pnl: EntityMonthPnl }> {
  await ensureMasterData();
  const cache = getCache();
  const company = cache.companies.find((c) => c.portfolio_id === portfolioId);
  if (!company) throw new Error(`Unknown portfolio ${portfolioId}`);

  const period = cache.period;
  const existingPnl =
    cache.pnl.find(
      (r) => r.entity_id === company.entity_id && r.period === period,
    ) ?? null;

  const before = {
    company: {
      arr_k: company.arr_k,
      net_burn_k: company.net_burn_k,
      cash_k: company.cash_k,
      runway_mo: company.runway_mo,
      mom_growth: company.mom_growth,
    },
    pnl: existingPnl
      ? {
          revenue_arr_k: existingPnl.revenue_arr_k,
          cogs_k: existingPnl.cogs_k,
          opex_k: existingPnl.opex_k,
          net_burn_k: existingPnl.net_burn_k,
          ending_cash_k: existingPnl.ending_cash_k,
        }
      : null,
  };

  const updatedCompany = await patchPortfolioCompany(portfolioId, {
    arr_k: patch.arr_k,
    net_burn_k: patch.net_burn_k,
    cash_k: patch.cash_k,
    runway_mo: patch.runway_mo,
    mom_growth: patch.mom_growth,
  });

  const nextPnl: EntityMonthPnl = {
    id: existingPnl?.id ?? crypto.randomUUID(),
    entity_id: company.entity_id,
    period,
    revenue_arr_k: patch.arr_k,
    cogs_k: patch.cogs_k ?? existingPnl?.cogs_k ?? 0,
    opex_k: patch.opex_k ?? existingPnl?.opex_k ?? 0,
    net_burn_k: patch.net_burn_k,
    ending_cash_k: patch.cash_k,
    is_firm: existingPnl?.is_firm ?? company.entity_id === 'ENT-FIRM',
  };

  const { upsertEntityMonthPnlRow, insertFinancialAudit } = await import(
    '@/lib/data/normalized/portfolio-repo'
  );
  const savedPnl = await upsertEntityMonthPnlRow(nextPnl);
  if (!savedPnl) {
    throw new Error(
      'Could not save P&L row — apply Phase 14 SQL and confirm Live DB.',
    );
  }

  const pnlIdx = cache.pnl.findIndex(
    (r) => r.entity_id === company.entity_id && r.period === period,
  );
  if (pnlIdx >= 0) cache.pnl[pnlIdx] = savedPnl;
  else cache.pnl.push(savedPnl);

  await insertFinancialAudit({
    audit_id: `FA-${crypto.randomUUID().slice(0, 8)}`,
    entity_id: company.entity_id,
    portfolio_id: portfolioId,
    period,
    actor_id: opts?.actorId ?? null,
    actor_email: opts?.actorEmail ?? null,
    patch: { ...patch },
    before_snapshot: before,
    after_snapshot: {
      company: {
        arr_k: updatedCompany.arr_k,
        net_burn_k: updatedCompany.net_burn_k,
        cash_k: updatedCompany.cash_k,
        runway_mo: updatedCompany.runway_mo,
        mom_growth: updatedCompany.mom_growth,
      },
      pnl: {
        revenue_arr_k: savedPnl.revenue_arr_k,
        cogs_k: savedPnl.cogs_k,
        opex_k: savedPnl.opex_k,
        net_burn_k: savedPnl.net_burn_k,
        ending_cash_k: savedPnl.ending_cash_k,
      },
    },
  });

  recordNormalizedSyncResult('portfolio_core_financials', true);
  return { company: updatedCompany, pnl: savedPnl };
}

export async function patchEntity(
  entityId: string,
  patch: Partial<Pick<Entity, 'notes' | 'coo_owner' | 'board_lead' | 'status'>>,
): Promise<Entity> {
  await ensureMasterData();
  const cache = getCache();
  const idx = cache.entities.findIndex((e) => e.entity_id === entityId);
  if (idx < 0) throw new Error(`Unknown entity ${entityId}`);

  const current = cache.entities[idx]!;
  const updated = await updateEntityFields(entityId, patch);
  if (!updated) {
    const { syncEntities } = await import(
      '@/lib/data/normalized/entities-repo'
    );
    const next: Entity = {
      ...current,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    const ok = await syncEntities([next]);
    if (!ok) {
      throw new Error(
        'Could not save entity changes — apply Phase 14 SQL and confirm Live DB.',
      );
    }
    cache.entities[idx] = next;
    cache.source = 'sql';
    recordNormalizedSyncResult('entity_patch', true);
    return next;
  }

  cache.entities[idx] = updated;
  cache.source = 'sql';
  recordNormalizedSyncResult('entity_patch', true);
  return updated;
}

/** Test / local reset helper. */
export function resetMasterDataCache() {
  globalThis.__tageMasterData = createFromSeed();
}
