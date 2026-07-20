import { createPersistClient } from '@/lib/supabase/persist-client';
import type { Entity } from '@/lib/types';

function entityToRow(entity: Entity) {
  return {
    id: entity.id,
    entity_id: entity.entity_id,
    canonical_name: entity.canonical_name,
    legal_name: entity.legal_name,
    // Canonical Phase 14 columns
    entity_type: entity.entity_type,
    track_origin: entity.track_origin,
    parent_entity_id: entity.parent_entity_id,
    status: entity.status,
    industry_module: entity.industry_module,
    qbe_class_or_company: entity.qbe_class_or_company,
    portfolio_id: entity.portfolio_id,
    coo_owner: entity.coo_owner,
    board_lead: entity.board_lead,
    close_date: entity.close_date,
    notes: entity.notes,
    // Legacy Phase 0 columns (kept in sync by trigger + explicit write)
    type: entity.entity_type,
    module: entity.industry_module,
    parent_id: entity.parent_entity_id,
    qbe_key: entity.qbe_class_or_company,
    ops_lead: entity.coo_owner,
    created_at: entity.created_at,
    updated_at: entity.updated_at,
  };
}

function rowToEntity(row: Record<string, unknown>): Entity {
  const entityType =
    (row.entity_type as string | null) ?? (row.type as string | null) ?? 'Subsidiary';
  return {
    id: String(row.id),
    entity_id: String(row.entity_id),
    canonical_name: String(row.canonical_name),
    legal_name: (row.legal_name as string | null) ?? null,
    entity_type: entityType as Entity['entity_type'],
    track_origin:
      ((row.track_origin as string | null) as Entity['track_origin']) ?? null,
    parent_entity_id:
      (row.parent_entity_id as string | null) ??
      (row.parent_id as string | null) ??
      null,
    status: (row.status as Entity['status']) ?? 'Active',
    industry_module:
      ((row.industry_module as string | null) as Entity['industry_module']) ??
      ((row.module as string | null) as Entity['industry_module']) ??
      null,
    qbe_class_or_company:
      (row.qbe_class_or_company as string | null) ??
      (row.qbe_key as string | null) ??
      null,
    portfolio_id: (row.portfolio_id as string | null) ?? null,
    coo_owner:
      (row.coo_owner as string | null) ?? (row.ops_lead as string | null) ?? null,
    board_lead: (row.board_lead as string | null) ?? null,
    close_date: row.close_date == null ? null : String(row.close_date),
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/** Returns null if table missing / error; empty array if ready but empty. */
export async function fetchAllEntities(): Promise<Entity[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('entities')
      .select('*')
      .order('canonical_name', { ascending: true });
    if (error) {
      console.error('fetchAllEntities', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToEntity(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllEntities', e);
    return null;
  }
}

export async function syncEntities(entities: Entity[]): Promise<boolean> {
  try {
    if (entities.length === 0) return true;
    const supabase = await createPersistClient();
    const { error } = await supabase
      .from('entities')
      .upsert(entities.map(entityToRow), { onConflict: 'entity_id' });
    if (error) {
      console.error('syncEntities', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('syncEntities', e);
    return false;
  }
}
