/**
 * Investor asset registry — CRUD + rollups with visibility filtering.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeAuditEvent } from '@/lib/audit/write';
import {
  assetClassLabel,
  breakdownBucket,
  defaultVisibilityForClass,
  filterAssetsForFirmAum,
  type AssetVisibilityScope,
  type InvestorAssetClass,
  type InvestorAssetSource,
} from '@/lib/net-worth/visibility';

export type InvestorAsset = {
  id: string;
  asset_key: string;
  name: string;
  institution: string;
  asset_class: InvestorAssetClass;
  visibility_scope: AssetVisibilityScope;
  entity_id: string | null;
  balance: number;
  currency: string;
  as_of: string;
  last_synced_at: string | null;
  source: InvestorAssetSource;
  external_id: string | null;
  connector_kind: string | null;
  notes: string;
};

function mapAsset(row: Record<string, unknown>): InvestorAsset {
  return {
    id: String(row.id),
    asset_key: String(row.asset_key),
    name: String(row.name),
    institution: String(row.institution ?? ''),
    asset_class: row.asset_class as InvestorAssetClass,
    visibility_scope: row.visibility_scope as AssetVisibilityScope,
    entity_id: (row.entity_id as string) ?? null,
    balance: Number(row.balance ?? 0),
    currency: String(row.currency ?? 'USD'),
    as_of: String(row.as_of),
    last_synced_at: row.last_synced_at ? String(row.last_synced_at) : null,
    source: (row.source as InvestorAssetSource) || 'manual',
    external_id: (row.external_id as string) ?? null,
    connector_kind: (row.connector_kind as string) ?? null,
    notes: String(row.notes ?? ''),
  };
}

function slugKey(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `ast-${base || 'asset'}-${Date.now().toString(36)}`;
}

export async function listInvestorAssets(opts?: {
  scope?: AssetVisibilityScope | 'all';
  includePrivate?: boolean;
}): Promise<{ rows: InvestorAsset[]; error?: string }> {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_investor_assets')
      .select('*')
      .order('asset_class', { ascending: true })
      .order('name', { ascending: true })
      .limit(500);
    if (opts?.scope && opts.scope !== 'all') {
      q = q.eq('visibility_scope', opts.scope);
    } else if (opts?.includePrivate === false) {
      q = q.eq('visibility_scope', 'firm_visible');
    }
    const { data, error } = await q;
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => mapAsset(r as Record<string, unknown>)),
    };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'List assets failed',
    };
  }
}

export type CreateInvestorAssetInput = {
  name: string;
  institution?: string;
  asset_class: InvestorAssetClass;
  entity_id?: string | null;
  balance: number;
  currency?: string;
  as_of?: string | null;
  source?: InvestorAssetSource;
  external_id?: string | null;
  connector_kind?: string | null;
  notes?: string;
  asset_key?: string;
  created_by?: string | null;
};

export async function createInvestorAsset(
  input: CreateInvestorAssetInput,
): Promise<{ ok: true; asset: InvestorAsset } | { ok: false; error: string }> {
  const visibility = defaultVisibilityForClass(input.asset_class);
  try {
    const sb = await createPersistClient();
    const row = {
      asset_key: input.asset_key?.trim() || slugKey(input.name),
      name: input.name.trim(),
      institution: input.institution?.trim() ?? '',
      asset_class: input.asset_class,
      visibility_scope: visibility,
      entity_id: input.entity_id ?? null,
      balance: input.balance,
      currency: (input.currency ?? 'USD').toUpperCase(),
      as_of: input.as_of ?? new Date().toISOString(),
      source: input.source ?? 'manual',
      external_id: input.external_id ?? null,
      connector_kind: input.connector_kind ?? null,
      notes: input.notes?.trim() ?? '',
      created_by: input.created_by ?? null,
      updated_by: input.created_by ?? null,
    };
    const { data, error } = await sb
      .from('os_investor_assets')
      .insert(row)
      .select('*')
      .single();
    if (error || !data) {
      return { ok: false, error: error?.message ?? 'Insert failed' };
    }
    const asset = mapAsset(data as Record<string, unknown>);
    await writeAuditEvent({
      action: 'net_worth_action',
      title: `Asset added · ${asset.name}`,
      object_type: 'investor_asset',
      object_id: asset.id,
      entity_id: asset.entity_id,
      metadata: {
        asset_class: asset.asset_class,
        visibility_scope: asset.visibility_scope,
        balance: asset.balance,
      },
    });
    return { ok: true, asset };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Create failed',
    };
  }
}

export async function updateInvestorAsset(
  id: string,
  patch: Partial<CreateInvestorAssetInput> & { updated_by?: string | null },
): Promise<{ ok: true; asset: InvestorAsset } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: patch.updated_by ?? null,
    };
    for (const key of [
      'name',
      'institution',
      'entity_id',
      'balance',
      'currency',
      'as_of',
      'source',
      'external_id',
      'connector_kind',
      'notes',
    ] as const) {
      if (patch[key] !== undefined) update[key] = patch[key];
    }
    if (patch.asset_class) {
      update.asset_class = patch.asset_class;
      update.visibility_scope = defaultVisibilityForClass(patch.asset_class);
    }
    const { data, error } = await sb
      .from('os_investor_assets')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      return { ok: false, error: error?.message ?? 'Update failed' };
    }
    const asset = mapAsset(data as Record<string, unknown>);
    await writeAuditEvent({
      action: 'net_worth_action',
      title: `Asset updated · ${asset.name}`,
      object_type: 'investor_asset',
      object_id: asset.id,
      entity_id: asset.entity_id,
      metadata: { balance: asset.balance, asset_class: asset.asset_class },
    });
    return { ok: true, asset };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Update failed',
    };
  }
}

export async function deleteInvestorAsset(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { error } = await sb.from('os_investor_assets').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    await writeAuditEvent({
      action: 'net_worth_action',
      title: 'Asset deleted',
      object_type: 'investor_asset',
      object_id: id,
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Delete failed',
    };
  }
}

/** Parse simple CSV: name,institution,asset_class,balance,currency,entity_id */
export function parseAssetCsv(text: string): CreateInvestorAssetInput[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const start = /asset_class|balance|name/i.test(lines[0]) ? 1 : 0;
  const out: CreateInvestorAssetInput[] = [];
  for (const line of lines.slice(start)) {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 4) continue;
    const [name, institution, assetClass, balanceStr, currency, entityId] = cols;
    const asset_class = assetClass as InvestorAssetClass;
    const balance = Number(balanceStr);
    if (!name || Number.isNaN(balance)) continue;
    if (
      !(
        [
          'brokerage',
          'retirement',
          'stock_fund',
          'crypto',
          'private_other',
          'business_equity',
          'real_estate',
          'firm_cash',
          'firm_other',
        ] as string[]
      ).includes(asset_class)
    ) {
      continue;
    }
    out.push({
      name,
      institution: institution || '',
      asset_class,
      balance,
      currency: currency || 'USD',
      entity_id: entityId || null,
      source: 'csv',
    });
  }
  return out;
}

export type NetWorthBreakdown = {
  investments: number;
  crypto: number;
  retirement: number;
  business: number;
  real_estate: number;
  firm_other: number;
  total: number;
  freshest_as_of: string | null;
  stale_count: number;
};

export function computeNetWorthBreakdown(
  assets: InvestorAsset[],
): NetWorthBreakdown {
  const buckets = {
    investments: 0,
    crypto: 0,
    retirement: 0,
    business: 0,
    real_estate: 0,
    firm_other: 0,
  };
  let freshest: string | null = null;
  let stale = 0;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const a of assets) {
    buckets[breakdownBucket(a.asset_class)] += a.balance;
    if (!freshest || a.as_of > freshest) freshest = a.as_of;
    if (new Date(a.as_of).getTime() < weekAgo) stale += 1;
  }
  const total = Object.values(buckets).reduce((s, n) => s + n, 0);
  return { ...buckets, total, freshest_as_of: freshest, stale_count: stale };
}

export type FirmAumSnapshot = {
  label: string;
  total: number;
  by_class: Array<{ asset_class: InvestorAssetClass; label: string; total: number }>;
  asset_count: number;
  freshest_as_of: string | null;
  excludes_private_i_quadrant: true;
};

export function computeFirmAum(assets: InvestorAsset[]): FirmAumSnapshot {
  const firm = filterAssetsForFirmAum(assets);
  const byClass = new Map<InvestorAssetClass, number>();
  let freshest: string | null = null;
  for (const a of firm) {
    byClass.set(a.asset_class, (byClass.get(a.asset_class) ?? 0) + a.balance);
    if (!freshest || a.as_of > freshest) freshest = a.as_of;
  }
  const total = firm.reduce((s, a) => s + a.balance, 0);
  return {
    label: 'Firm AUM · operating & real estate',
    total,
    by_class: [...byClass.entries()].map(([asset_class, t]) => ({
      asset_class,
      label: assetClassLabel(asset_class),
      total: t,
    })),
    asset_count: firm.length,
    freshest_as_of: freshest,
    excludes_private_i_quadrant: true,
  };
}

export async function getFirmAumSnapshot(): Promise<FirmAumSnapshot> {
  const { rows } = await listInvestorAssets({ includePrivate: false });
  return computeFirmAum(rows);
}
