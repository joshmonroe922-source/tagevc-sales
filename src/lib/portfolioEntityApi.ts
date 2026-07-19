import { requireSupabase } from './supabase';
import type { FinancialPeriodType } from './portfolioEntity';

export type EntityLeadership = {
  entity_id: string;
  strategy_md: string;
  goals_md: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ThinkTankScope = 'personal' | 'entity';

export type ThinkTankConversation = {
  id: string;
  entity_id: string | null;
  user_id: string;
  scope: ThinkTankScope;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ThinkTankMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  created_at: string;
};

export type EntityKpi = {
  id: string;
  entity_id: string;
  key: string;
  label: string;
  description: string;
  unit: string;
  target_value: number | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type EntityKpiValue = {
  id: string;
  kpi_id: string;
  period_key: string;
  period_label: string;
  value: number | null;
  notes: string;
  recorded_at: string;
  recorded_by: string | null;
};

export type EntityFinancialSnapshot = {
  id: string;
  entity_id: string;
  period_type: FinancialPeriodType;
  period_key: string;
  period_label: string;
  revenue: number | null;
  cogs: number | null;
  opex: number | null;
  net_income: number | null;
  cash: number | null;
  currency: string;
  source: string;
  notes: string;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function getEntityLeadership(
  entityId: string,
): Promise<EntityLeadership | null> {
  const { data, error } = await requireSupabase()
    .from('entity_leadership')
    .select('*')
    .eq('entity_id', entityId)
    .maybeSingle();
  if (error) throw error;
  return data as EntityLeadership | null;
}

export async function upsertEntityLeadership(input: {
  entityId: string;
  strategy_md: string;
  goals_md: string;
  updated_by?: string | null;
}): Promise<EntityLeadership> {
  const { data, error } = await requireSupabase()
    .from('entity_leadership')
    .upsert(
      {
        entity_id: input.entityId,
        strategy_md: input.strategy_md,
        goals_md: input.goals_md,
        updated_by: input.updated_by ?? null,
      },
      { onConflict: 'entity_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return data as EntityLeadership;
}

export async function getOrCreateThinkTankConversation(input: {
  userId: string;
  scope?: ThinkTankScope;
  entityId?: string;
}): Promise<ThinkTankConversation> {
  const scope: ThinkTankScope =
    input.scope ?? (input.entityId ? 'entity' : 'personal');
  if (scope === 'entity' && !input.entityId) {
    throw new Error('entityId is required for entity Think Tank');
  }

  const client = requireSupabase();
  let query = client
    .from('think_tank_conversations')
    .select('*')
    .eq('user_id', input.userId)
    .eq('scope', scope);

  if (scope === 'entity') {
    query = query.eq('entity_id', input.entityId!);
  } else {
    query = query.is('entity_id', null);
  }

  const { data: existing, error: readErr } = await query.maybeSingle();
  if (readErr) throw readErr;
  if (existing) return existing as ThinkTankConversation;

  const { data, error } = await client
    .from('think_tank_conversations')
    .insert({
      entity_id: scope === 'entity' ? input.entityId! : null,
      user_id: input.userId,
      scope,
      title: scope === 'personal' ? 'Personal journal' : 'Journal',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as ThinkTankConversation;
}

export async function listThinkTankMessages(
  conversationId: string,
): Promise<ThinkTankMessage[]> {
  const { data, error } = await requireSupabase()
    .from('think_tank_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ThinkTankMessage[];
}

export async function listEntityKpis(entityId: string): Promise<EntityKpi[]> {
  const { data, error } = await requireSupabase()
    .from('entity_kpis')
    .select('*')
    .eq('entity_id', entityId)
    .eq('active', true)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as EntityKpi[];
}

export async function upsertEntityKpi(input: {
  id?: string;
  entity_id: string;
  key: string;
  label: string;
  description?: string;
  unit?: string;
  target_value?: number | null;
  sort_order?: number;
  active?: boolean;
}): Promise<EntityKpi> {
  const client = requireSupabase();
  if (input.id) {
    const { data, error } = await client
      .from('entity_kpis')
      .update({
        label: input.label,
        description: input.description ?? '',
        unit: input.unit ?? '',
        target_value: input.target_value ?? null,
        sort_order: input.sort_order ?? 0,
        active: input.active ?? true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as EntityKpi;
  }
  const { data, error } = await client
    .from('entity_kpis')
    .upsert(
      {
        entity_id: input.entity_id,
        key: input.key,
        label: input.label,
        description: input.description ?? '',
        unit: input.unit ?? '',
        target_value: input.target_value ?? null,
        sort_order: input.sort_order ?? 0,
        active: input.active ?? true,
      },
      { onConflict: 'entity_id,key' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return data as EntityKpi;
}

export async function listEntityKpiValues(
  kpiIds: string[],
): Promise<EntityKpiValue[]> {
  if (kpiIds.length === 0) return [];
  const { data, error } = await requireSupabase()
    .from('entity_kpi_values')
    .select('*')
    .in('kpi_id', kpiIds)
    .order('recorded_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as EntityKpiValue[];
}

export async function upsertEntityKpiValue(input: {
  kpi_id: string;
  period_key: string;
  period_label?: string;
  value: number | null;
  notes?: string;
  recorded_by?: string | null;
}): Promise<EntityKpiValue> {
  const { data, error } = await requireSupabase()
    .from('entity_kpi_values')
    .upsert(
      {
        kpi_id: input.kpi_id,
        period_key: input.period_key,
        period_label: input.period_label ?? input.period_key,
        value: input.value,
        notes: input.notes ?? '',
        recorded_by: input.recorded_by ?? null,
        recorded_at: new Date().toISOString(),
      },
      { onConflict: 'kpi_id,period_key' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return data as EntityKpiValue;
}

export async function listFinancialSnapshots(
  entityId: string,
  periodType?: FinancialPeriodType,
): Promise<EntityFinancialSnapshot[]> {
  let q = requireSupabase()
    .from('entity_financial_snapshots')
    .select('*')
    .eq('entity_id', entityId)
    .order('period_key', { ascending: false });
  if (periodType) q = q.eq('period_type', periodType);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EntityFinancialSnapshot[];
}

/**
 * Hook point for future entity reporting sync.
 * Today returns existing rows; callers may seed stub placeholders in UI.
 */
export async function syncEntityFinancialsFromReporting(
  _entityId: string,
): Promise<{ ok: true; synced: number; stub: true }> {
  // Intentionally stubbed — wire to Company-Books / finance close when ready.
  return { ok: true, synced: 0, stub: true };
}

export async function upsertFinancialSnapshot(
  input: Omit<
    EntityFinancialSnapshot,
    'id' | 'created_at' | 'updated_at' | 'synced_at'
  > & { id?: string; synced_at?: string | null },
): Promise<EntityFinancialSnapshot> {
  const { data, error } = await requireSupabase()
    .from('entity_financial_snapshots')
    .upsert(
      {
        ...input,
        synced_at: input.synced_at ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'entity_id,period_type,period_key' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return data as EntityFinancialSnapshot;
}
