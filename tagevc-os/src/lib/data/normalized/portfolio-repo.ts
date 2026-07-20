import { createPersistClient } from '@/lib/supabase/persist-client';
import type {
  EntityMonthKpi,
  EntityMonthKpiFlex,
  EntityMonthPnl,
  PortfolioCompany,
} from '@/lib/types';

function companyToRow(c: PortfolioCompany) {
  return {
    id: c.id,
    portfolio_id: c.portfolio_id,
    entity_id: c.entity_id,
    company_name: c.company_name,
    deal_id: c.deal_id,
    path: c.path,
    close_date: c.close_date,
    coo_owner: c.coo_owner,
    board_lead: c.board_lead,
    arr_k: c.arr_k,
    mom_growth: c.mom_growth,
    net_burn_k: c.net_burn_k,
    runway_mo: c.runway_mo,
    cash_k: c.cash_k,
    health: c.health,
    top_risk: c.top_risk,
    next_milestone: c.next_milestone,
    last_update: c.last_update,
    notes: c.notes,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

function rowToCompany(row: Record<string, unknown>): PortfolioCompany {
  return {
    id: String(row.id),
    portfolio_id: String(row.portfolio_id),
    entity_id: String(row.entity_id),
    company_name: String(row.company_name),
    deal_id: (row.deal_id as string | null) ?? null,
    path: (row.path as PortfolioCompany['path']) ?? null,
    close_date: row.close_date == null ? null : String(row.close_date),
    coo_owner: (row.coo_owner as string | null) ?? null,
    board_lead: (row.board_lead as string | null) ?? null,
    arr_k: Number(row.arr_k ?? 0),
    mom_growth: row.mom_growth == null ? null : Number(row.mom_growth),
    net_burn_k: Number(row.net_burn_k ?? 0),
    runway_mo: row.runway_mo == null ? null : Number(row.runway_mo),
    cash_k: Number(row.cash_k ?? 0),
    health: row.health as PortfolioCompany['health'],
    top_risk: (row.top_risk as string | null) ?? null,
    next_milestone: (row.next_milestone as string | null) ?? null,
    last_update: row.last_update == null ? null : String(row.last_update),
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function pnlToRow(r: EntityMonthPnl) {
  return {
    id: r.id,
    entity_id: r.entity_id,
    period: r.period,
    revenue_arr_k: r.revenue_arr_k,
    cogs_k: r.cogs_k,
    opex_k: r.opex_k,
    net_burn_k: r.net_burn_k,
    ending_cash_k: r.ending_cash_k,
    is_firm: r.is_firm,
  };
}

function rowToPnl(row: Record<string, unknown>): EntityMonthPnl {
  return {
    id: String(row.id),
    entity_id: String(row.entity_id),
    period: String(row.period),
    revenue_arr_k: Number(row.revenue_arr_k ?? 0),
    cogs_k: Number(row.cogs_k ?? 0),
    opex_k: Number(row.opex_k ?? 0),
    net_burn_k: Number(row.net_burn_k ?? 0),
    ending_cash_k: Number(row.ending_cash_k ?? 0),
    is_firm: Boolean(row.is_firm),
  };
}

function kpiToRow(k: EntityMonthKpi) {
  return {
    id: k.id,
    entity_id: k.entity_id,
    period: k.period,
    kpi_key: k.kpi_key,
    label: k.label,
    value_num: k.value_num,
    value_text: k.value_text,
    unit: k.unit,
    method: k.method,
    standard: k.standard,
  };
}

function rowToKpi(row: Record<string, unknown>): EntityMonthKpi {
  return {
    id: String(row.id),
    entity_id: String(row.entity_id),
    period: String(row.period),
    kpi_key: String(row.kpi_key),
    label: String(row.label),
    value_num: row.value_num == null ? null : Number(row.value_num),
    value_text: (row.value_text as string | null) ?? null,
    unit: (row.unit as string | null) ?? null,
    method: row.method as EntityMonthKpi['method'],
    standard: 'CORE',
  };
}

function flexToRow(k: EntityMonthKpiFlex) {
  return {
    id: k.id,
    entity_id: k.entity_id,
    period: k.period,
    flex_key: k.flex_key,
    label: k.label,
    value_num: k.value_num,
    value_text: k.value_text,
    unit: k.unit,
    industry_module: k.industry_module,
    standard: k.standard,
  };
}

function rowToFlex(row: Record<string, unknown>): EntityMonthKpiFlex {
  return {
    id: String(row.id),
    entity_id: String(row.entity_id),
    period: String(row.period),
    flex_key: String(row.flex_key),
    label: String(row.label),
    value_num: row.value_num == null ? null : Number(row.value_num),
    value_text: (row.value_text as string | null) ?? null,
    unit: (row.unit as string | null) ?? null,
    industry_module: String(row.industry_module),
    standard: 'FLEX',
  };
}

export async function fetchAllPortfolioCompanies(): Promise<
  PortfolioCompany[] | null
> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('portfolio_companies')
      .select('*')
      .order('company_name', { ascending: true });
    if (error) {
      console.error('fetchAllPortfolioCompanies', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToCompany(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllPortfolioCompanies', e);
    return null;
  }
}

export async function fetchAllEntityMonthPnl(): Promise<EntityMonthPnl[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('entity_month_pnl')
      .select('*')
      .order('period', { ascending: false });
    if (error) {
      console.error('fetchAllEntityMonthPnl', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToPnl(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllEntityMonthPnl', e);
    return null;
  }
}

export async function fetchAllEntityMonthKpis(): Promise<EntityMonthKpi[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('entity_month_kpi')
      .select('*')
      .order('kpi_key', { ascending: true });
    if (error) {
      console.error('fetchAllEntityMonthKpis', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToKpi(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllEntityMonthKpis', e);
    return null;
  }
}

export async function fetchAllEntityMonthKpiFlex(): Promise<
  EntityMonthKpiFlex[] | null
> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('entity_month_kpi_flex')
      .select('*')
      .order('flex_key', { ascending: true });
    if (error) {
      console.error('fetchAllEntityMonthKpiFlex', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToFlex(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllEntityMonthKpiFlex', e);
    return null;
  }
}

export async function syncPortfolioCompanies(
  companies: PortfolioCompany[],
): Promise<boolean> {
  try {
    if (companies.length === 0) return true;
    const supabase = await createPersistClient();
    const { error } = await supabase
      .from('portfolio_companies')
      .upsert(companies.map(companyToRow), { onConflict: 'portfolio_id' });
    if (error) {
      console.error('syncPortfolioCompanies', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('syncPortfolioCompanies', e);
    return false;
  }
}

/** Partial SQL-first update for Portfolio Active narrative + CORE $ fields. */
export async function updatePortfolioCompanyFields(
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
      | 'last_update'
      | 'arr_k'
      | 'mom_growth'
      | 'net_burn_k'
      | 'runway_mo'
      | 'cash_k'
    >
  >,
): Promise<PortfolioCompany | null> {
  try {
    const supabase = await createPersistClient();
    const { data: existing, error: fetchError } = await supabase
      .from('portfolio_companies')
      .select('*')
      .eq('portfolio_id', portfolioId)
      .maybeSingle();
    if (fetchError) {
      console.error('updatePortfolioCompanyFields fetch', fetchError.message);
      return null;
    }
    if (!existing) return null;

    const current = rowToCompany(existing as Record<string, unknown>);
    const next: PortfolioCompany = {
      ...current,
      ...patch,
      last_update:
        patch.last_update ?? new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('portfolio_companies')
      .upsert(companyToRow(next), { onConflict: 'portfolio_id' });
    if (error) {
      console.error('updatePortfolioCompanyFields', error.message);
      return null;
    }
    return next;
  } catch (e) {
    console.error('updatePortfolioCompanyFields', e);
    return null;
  }
}

export async function syncEntityMonthPnl(
  rows: EntityMonthPnl[],
): Promise<boolean> {
  try {
    if (rows.length === 0) return true;
    const supabase = await createPersistClient();
    const { error } = await supabase
      .from('entity_month_pnl')
      .upsert(rows.map(pnlToRow), { onConflict: 'entity_id,period' });
    if (error) {
      console.error('syncEntityMonthPnl', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('syncEntityMonthPnl', e);
    return false;
  }
}

/** Upsert a single period P&L row (rollup-aligned with Portfolio CORE). */
export async function upsertEntityMonthPnlRow(
  row: EntityMonthPnl,
): Promise<EntityMonthPnl | null> {
  const ok = await syncEntityMonthPnl([row]);
  return ok ? row : null;
}

export async function insertFinancialAudit(input: {
  audit_id: string;
  entity_id: string;
  portfolio_id: string | null;
  period: string;
  actor_id: string | null;
  actor_email: string | null;
  patch: Record<string, unknown>;
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown>;
}): Promise<boolean> {
  try {
    const supabase = await createPersistClient();
    const { error } = await supabase.from('os_financial_audits').insert({
      audit_id: input.audit_id,
      entity_id: input.entity_id,
      portfolio_id: input.portfolio_id,
      period: input.period,
      actor_id: input.actor_id,
      actor_email: input.actor_email,
      patch: input.patch,
      before_snapshot: input.before_snapshot,
      after_snapshot: input.after_snapshot,
    });
    if (error) {
      // Table may not exist until Phase 18 SQL — non-fatal
      if (!error.message.includes('os_financial_audits')) {
        console.error('insertFinancialAudit', error.message);
      }
      return false;
    }
    return true;
  } catch (e) {
    console.error('insertFinancialAudit', e);
    return false;
  }
}

export async function syncEntityMonthKpis(
  rows: EntityMonthKpi[],
): Promise<boolean> {
  try {
    if (rows.length === 0) return true;
    const supabase = await createPersistClient();
    const { error } = await supabase
      .from('entity_month_kpi')
      .upsert(rows.map(kpiToRow), { onConflict: 'entity_id,period,kpi_key' });
    if (error) {
      console.error('syncEntityMonthKpis', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('syncEntityMonthKpis', e);
    return false;
  }
}

export async function syncEntityMonthKpiFlex(
  rows: EntityMonthKpiFlex[],
): Promise<boolean> {
  try {
    if (rows.length === 0) return true;
    const supabase = await createPersistClient();
    const { error } = await supabase
      .from('entity_month_kpi_flex')
      .upsert(rows.map(flexToRow), {
        onConflict: 'entity_id,period,flex_key',
      });
    if (error) {
      console.error('syncEntityMonthKpiFlex', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('syncEntityMonthKpiFlex', e);
    return false;
  }
}

export async function upsertEntityMonthKpiRow(
  row: EntityMonthKpi,
): Promise<EntityMonthKpi | null> {
  const ok = await syncEntityMonthKpis([row]);
  return ok ? row : null;
}

export async function upsertEntityMonthKpiFlexRow(
  row: EntityMonthKpiFlex,
): Promise<EntityMonthKpiFlex | null> {
  const ok = await syncEntityMonthKpiFlex([row]);
  return ok ? row : null;
}

export type FinancialAuditRow = {
  id: string;
  audit_id: string;
  entity_id: string;
  portfolio_id: string | null;
  period: string;
  actor_email: string | null;
  patch: Record<string, unknown>;
  created_at: string;
};

export async function listFinancialAuditsForEntity(
  entityId: string,
  limit = 25,
): Promise<FinancialAuditRow[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_financial_audits')
      .select(
        'id, audit_id, entity_id, portfolio_id, period, actor_email, patch, created_at',
      )
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      if (!error.message.includes('os_financial_audits')) {
        console.error('listFinancialAuditsForEntity', error.message);
      }
      return null;
    }
    return (data ?? []).map((r) => ({
      id: String(r.id),
      audit_id: String(r.audit_id),
      entity_id: String(r.entity_id),
      portfolio_id: (r.portfolio_id as string | null) ?? null,
      period: String(r.period),
      actor_email: (r.actor_email as string | null) ?? null,
      patch: (r.patch as Record<string, unknown>) ?? {},
      created_at: String(r.created_at),
    }));
  } catch (e) {
    console.error('listFinancialAuditsForEntity', e);
    return null;
  }
}

/** Seed → SQL migrate for all portfolio master tables (entities first). */
export async function syncPortfolioMaster(input: {
  companies: PortfolioCompany[];
  pnl: EntityMonthPnl[];
  coreKpis: EntityMonthKpi[];
  flexKpis: EntityMonthKpiFlex[];
}): Promise<boolean> {
  const a = await syncPortfolioCompanies(input.companies);
  if (!a) return false;
  const b = await syncEntityMonthPnl(input.pnl);
  if (!b) return false;
  const c = await syncEntityMonthKpis(input.coreKpis);
  if (!c) return false;
  return syncEntityMonthKpiFlex(input.flexKpis);
}
