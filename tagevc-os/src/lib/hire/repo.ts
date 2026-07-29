import { createClient } from '@/lib/supabase/server';
import { createPersistClient } from '@/lib/supabase/persist-client';
import type {
  HireImpactScenario,
  HireRoleCostTemplate,
} from '@/lib/hire/impact';
import { normalizeEntityId } from '@/lib/entities/display-name';

/** Preferred Hire Impact dropdown order for recruiting roles, then title A–Z. */
const ROLE_KEY_SORT: Record<string, number> = {
  recruiter: 10,
  senior_recruiter: 20,
  team_lead: 30,
};

function mapTemplate(row: Record<string, unknown>): HireRoleCostTemplate {
  return {
    id: String(row.id),
    entity_id: String(row.entity_id),
    role_key: String(row.role_key),
    title: String(row.title),
    level_label: String(row.level_label ?? ''),
    base_salary_annual: Number(row.base_salary_annual ?? 0),
    burden_pct: Number(row.burden_pct ?? 0.3),
    tools_annual: Number(row.tools_annual ?? 0),
    recruiting_one_time: Number(row.recruiting_one_time ?? 0),
    notes: (row.notes as string | null) ?? null,
    active: row.active !== false,
  };
}

function sortTemplates(templates: HireRoleCostTemplate[]): HireRoleCostTemplate[] {
  return [...templates].sort((a, b) => {
    const ao = ROLE_KEY_SORT[a.role_key] ?? 1000;
    const bo = ROLE_KEY_SORT[b.role_key] ?? 1000;
    if (ao !== bo) return ao - bo;
    return a.title.localeCompare(b.title);
  });
}

function mapScenario(row: Record<string, unknown>): HireImpactScenario {
  return {
    id: String(row.id),
    entity_id: String(row.entity_id),
    title: String(row.title),
    template_id: (row.template_id as string | null) ?? null,
    role_title: String(row.role_title),
    manager_profile_id: (row.manager_profile_id as string | null) ?? null,
    hris_employee_id: (row.hris_employee_id as string | null) ?? null,
    headcount: Number(row.headcount ?? 1),
    start_month: String(row.start_month).slice(0, 10),
    months: Number(row.months ?? 12),
    base_salary_annual: Number(row.base_salary_annual ?? 0),
    burden_pct: Number(row.burden_pct ?? 0.3),
    tools_annual: Number(row.tools_annual ?? 0),
    recruiting_one_time: Number(row.recruiting_one_time ?? 0),
    status: (row.status as HireImpactScenario['status']) ?? 'draft',
    assumptions_locked: Boolean(row.assumptions_locked),
    notes: (row.notes as string | null) ?? null,
  };
}

export async function listHireCostTemplates(entityId?: string | null): Promise<{
  templates: HireRoleCostTemplate[];
  tableReady: boolean;
  error?: string;
}> {
  try {
    const supabase = await createClient();
    let q = supabase
      .from('os_hire_role_cost_templates')
      .select('*')
      .eq('active', true)
      .order('title', { ascending: true });
    if (entityId) q = q.eq('entity_id', normalizeEntityId(entityId));
    const { data, error } = await q;
    if (error) {
      if (/does not exist|42P01/i.test(error.message)) {
        return { templates: [], tableReady: false, error: error.message };
      }
      return { templates: [], tableReady: true, error: error.message };
    }
    return {
      templates: sortTemplates(
        (data ?? []).map((r) => mapTemplate(r as Record<string, unknown>)),
      ),
      tableReady: true,
    };
  } catch (e) {
    return {
      templates: [],
      tableReady: false,
      error: e instanceof Error ? e.message : 'Failed',
    };
  }
}

export async function listHireScenarios(entityId?: string | null): Promise<{
  scenarios: HireImpactScenario[];
  tableReady: boolean;
  error?: string;
}> {
  try {
    const supabase = await createClient();
    let q = supabase
      .from('os_hire_impact_scenarios')
      .select('*')
      .neq('status', 'cancelled')
      .order('start_month', { ascending: true });
    if (entityId) q = q.eq('entity_id', normalizeEntityId(entityId));
    const { data, error } = await q;
    if (error) {
      if (/does not exist|42P01/i.test(error.message)) {
        return { scenarios: [], tableReady: false, error: error.message };
      }
      return { scenarios: [], tableReady: true, error: error.message };
    }
    return {
      scenarios: (data ?? []).map((r) => mapScenario(r as Record<string, unknown>)),
      tableReady: true,
    };
  } catch (e) {
    return {
      scenarios: [],
      tableReady: false,
      error: e instanceof Error ? e.message : 'Failed',
    };
  }
}

export async function upsertHireCostTemplate(input: {
  id?: string;
  entity_id: string;
  role_key: string;
  title: string;
  level_label?: string;
  base_salary_annual: number;
  burden_pct: number;
  tools_annual: number;
  recruiting_one_time: number;
  notes?: string;
  created_by?: string | null;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const sb = await createPersistClient();
    const row = {
      id: input.id,
      entity_id: normalizeEntityId(input.entity_id),
      role_key: input.role_key.trim().toLowerCase().replace(/\s+/g, '_'),
      title: input.title.trim(),
      level_label: input.level_label?.trim() ?? '',
      base_salary_annual: input.base_salary_annual,
      burden_pct: input.burden_pct,
      tools_annual: input.tools_annual,
      recruiting_one_time: input.recruiting_one_time,
      notes: input.notes?.trim() || null,
      created_by: input.created_by ?? null,
      updated_at: new Date().toISOString(),
      active: true,
    };
    const { data, error } = await sb
      .from('os_hire_role_cost_templates')
      .upsert(row, { onConflict: 'entity_id,role_key' })
      .select('id')
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data?.id as string | undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function createHireScenario(input: {
  entity_id: string;
  title: string;
  template_id?: string | null;
  role_title: string;
  manager_profile_id?: string | null;
  hris_employee_id?: string | null;
  headcount?: number;
  start_month: string;
  months?: number;
  base_salary_annual: number;
  burden_pct: number;
  tools_annual: number;
  recruiting_one_time: number;
  status?: HireImpactScenario['status'];
  notes?: string;
  created_by?: string | null;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_hire_impact_scenarios')
      .insert({
        entity_id: normalizeEntityId(input.entity_id),
        title: input.title.trim(),
        template_id: input.template_id ?? null,
        role_title: input.role_title.trim(),
        manager_profile_id: input.manager_profile_id ?? null,
        hris_employee_id: input.hris_employee_id ?? null,
        headcount: input.headcount ?? 1,
        start_month: input.start_month.slice(0, 10),
        months: input.months ?? 12,
        base_salary_annual: input.base_salary_annual,
        burden_pct: input.burden_pct,
        tools_annual: input.tools_annual,
        recruiting_one_time: input.recruiting_one_time,
        status: input.status ?? 'planned',
        notes: input.notes?.trim() || null,
        created_by: input.created_by ?? null,
      })
      .select('id')
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data?.id as string | undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function updateHireScenarioAssumptions(input: {
  id: string;
  base_salary_annual?: number;
  burden_pct?: number;
  tools_annual?: number;
  recruiting_one_time?: number;
  months?: number;
  headcount?: number;
  status?: HireImpactScenario['status'];
  notes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const sb = await createPersistClient();
    const existing = await sb
      .from('os_hire_impact_scenarios')
      .select('assumptions_locked')
      .eq('id', input.id)
      .maybeSingle();
    if (existing.data?.assumptions_locked) {
      return { ok: false, error: 'Assumptions locked (IES payroll live).' };
    }
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    for (const k of [
      'base_salary_annual',
      'burden_pct',
      'tools_annual',
      'recruiting_one_time',
      'months',
      'headcount',
      'status',
      'notes',
    ] as const) {
      if (input[k] !== undefined) patch[k] = input[k];
    }
    const { error } = await sb
      .from('os_hire_impact_scenarios')
      .update(patch)
      .eq('id', input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}
