/**
 * Traction EOS dashboard — entity_id-scoped spine with Tage Consolidated rollup.
 */
import { createClient } from '@/lib/supabase/server';
import { currentQuarterKey, weekKeyFromDate } from '@/lib/eos/dates';
import type {
  EosEntityRollup,
  EosIssue,
  EosRock,
  EosScorecardEntry,
  EosTodo,
  EosVto,
} from '@/lib/eos/types';
import { CONSOLIDATED_SELECT_VALUE } from '@/lib/entities/display-order';
import { normalizeEntityId } from '@/lib/entities/display-name';

export type EosDashboard = {
  scope: string;
  isConsolidated: boolean;
  entityIds: string[];
  weekKey: string;
  quarterKey: string;
  rocks: EosRock[];
  issues: EosIssue[];
  todos: EosTodo[];
  scorecard: EosScorecardEntry[];
  vto: EosVto | null;
  rollups: EosEntityRollup[];
  tableReady: boolean;
  error?: string;
};

const OPERATING_ENTITY_IDS = [
  'ENT-FIRM',
  'ENT-R619',
  'ENT-SIGNENT',
  'ENT-INDA',
] as const;

function isMissingTable(msg: string): boolean {
  return /does not exist|42P01/i.test(msg);
}

export function resolveEosScope(
  raw: string | null | undefined,
): { scope: string; isConsolidated: boolean; entityIds: string[] } {
  const trimmed = (raw ?? '').trim();
  if (
    !trimmed ||
    trimmed === CONSOLIDATED_SELECT_VALUE ||
    trimmed === 'all'
  ) {
    return {
      scope: CONSOLIDATED_SELECT_VALUE,
      isConsolidated: true,
      entityIds: [...OPERATING_ENTITY_IDS],
    };
  }
  const id = normalizeEntityId(trimmed);
  return {
    scope: id,
    isConsolidated: false,
    entityIds: [id],
  };
}

function buildRollups(input: {
  rocks: EosRock[];
  issues: EosIssue[];
  todos: EosTodo[];
  scorecard: EosScorecardEntry[];
  entityIds: string[];
}): EosEntityRollup[] {
  return input.entityIds.map((entity_id) => {
    const rocks = input.rocks.filter((r) => r.entity_id === entity_id);
    const issues = input.issues.filter((i) => i.entity_id === entity_id);
    const todos = input.todos.filter((t) => t.entity_id === entity_id);
    const scorecard = input.scorecard.filter((s) => s.entity_id === entity_id);
    return {
      entity_id,
      rocks_total: rocks.length,
      rocks_on_track: rocks.filter((r) => r.status === 'on_track').length,
      rocks_off_track: rocks.filter((r) => r.status === 'off_track').length,
      issues_open: issues.filter((i) =>
        ['open', 'discussing'].includes(i.status),
      ).length,
      todos_open: todos.filter((t) => t.status === 'open').length,
      scorecard_on_track: scorecard.filter((s) => s.on_track === true).length,
      scorecard_total: scorecard.length,
    };
  });
}

export async function loadEosDashboard(opts: {
  scope?: string | null;
  profileId?: string;
  weekKey?: string;
  quarterKey?: string;
}): Promise<EosDashboard> {
  const weekKey = opts.weekKey || weekKeyFromDate();
  const quarterKey = opts.quarterKey || currentQuarterKey();
  const { scope, isConsolidated, entityIds } = resolveEosScope(opts.scope);
  const supabase = await createClient();

  const [rocksRes, issuesRes, todosRes, metricsRes, entriesRes, vtoRes] =
    await Promise.all([
      supabase
        .from('os_eos_rocks')
        .select(
          'id, entity_id, quarter_key, title, description, scope, status, owner_profile_id',
        )
        .in('entity_id', entityIds)
        .eq('quarter_key', quarterKey)
        .order('created_at', { ascending: true }),
      supabase
        .from('os_eos_issues')
        .select(
          'id, entity_id, title, detail, scope, status, priority, owner_profile_id, raised_by_profile_id',
        )
        .in('entity_id', entityIds)
        .in('status', ['open', 'discussing'])
        .order('priority', { ascending: false })
        .limit(80),
      supabase
        .from('os_eos_todos')
        .select(
          'id, entity_id, title, status, assignee_profile_id, due_at',
        )
        .in('entity_id', entityIds)
        .eq('status', 'open')
        .order('due_at', { ascending: true })
        .limit(80),
      supabase
        .from('os_eos_scorecard_metrics')
        .select('entity_id, metric_key, label, goal, unit, scope, sort_order')
        .in('entity_id', entityIds)
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('os_eos_scorecard_entries')
        .select(
          'id, entity_id, metric_key, week_key, goal, actual, unit, scope, on_track',
        )
        .in('entity_id', entityIds)
        .eq('week_key', weekKey),
      !isConsolidated
        ? supabase
            .from('os_eos_vto')
            .select(
              'entity_id, core_values, core_focus, ten_year_target, three_year_picture, one_year_plan, marketing_strategy, issues_list_notes',
            )
            .eq('entity_id', entityIds[0])
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  const missing =
    (rocksRes.error && isMissingTable(rocksRes.error.message)) ||
    (issuesRes.error && isMissingTable(issuesRes.error.message)) ||
    (todosRes.error && isMissingTable(todosRes.error.message));

  if (missing) {
    return {
      scope,
      isConsolidated,
      entityIds,
      weekKey,
      quarterKey,
      rocks: [],
      issues: [],
      todos: [],
      scorecard: [],
      vto: null,
      rollups: [],
      tableReady: false,
      error:
        'Apply supabase/phase84_eos_operating_system.sql for EOS spine tables.',
    };
  }

  const rocks = (rocksRes.data ?? []) as EosRock[];
  const issues = (issuesRes.data ?? []) as EosIssue[];
  const todos = (todosRes.data ?? []) as EosTodo[];
  const metrics = metricsRes.data ?? [];
  const entries = entriesRes.data ?? [];

  const entryMap = new Map(
    entries.map((e) => [`${e.entity_id}:${e.metric_key}`, e]),
  );

  const scorecard: EosScorecardEntry[] = metrics.map((m) => {
    const entry = entryMap.get(`${m.entity_id}:${m.metric_key}`);
    const goal =
      entry?.goal != null
        ? Number(entry.goal)
        : m.goal != null
          ? Number(m.goal)
          : null;
    const actual = entry?.actual != null ? Number(entry.actual) : null;
    const on_track =
      entry?.on_track ??
      (actual != null && goal != null ? actual >= goal : null);
    return {
      id: entry?.id ?? `metric-${m.entity_id}-${m.metric_key}`,
      entity_id: m.entity_id,
      week_key: weekKey,
      metric_key: m.metric_key,
      label: m.label,
      goal,
      actual,
      unit: String(entry?.unit ?? m.unit ?? 'count'),
      scope: (entry?.scope ?? m.scope ?? 'company') as EosScorecardEntry['scope'],
      on_track,
    };
  });

  return {
    scope,
    isConsolidated,
    entityIds,
    weekKey,
    quarterKey,
    rocks,
    issues,
    todos,
    scorecard,
    vto: (vtoRes.data as EosVto | null) ?? null,
    rollups: buildRollups({ rocks, issues, todos, scorecard, entityIds }),
    tableReady: true,
    error:
      rocksRes.error?.message ||
      issuesRes.error?.message ||
      todosRes.error?.message ||
      metricsRes.error?.message ||
      entriesRes.error?.message ||
      vtoRes.error?.message,
  };
}

export async function createEosRock(input: {
  entityId: string;
  profileId: string;
  title: string;
  detail?: string | null;
  quarterKey?: string;
  sourcePortal?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: 'Title required.' };
  const entityId = normalizeEntityId(input.entityId);
  if (!entityId || entityId === CONSOLIDATED_SELECT_VALUE) {
    return { ok: false, error: 'Pick a company scope to add a rock.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('os_eos_rocks').insert({
    entity_id: entityId,
    quarter_key: input.quarterKey || currentQuarterKey(),
    title,
    description: input.detail?.trim() || null,
    scope: 'company',
    status: 'on_track',
    owner_profile_id: input.profileId,
    source_portal: input.sourcePortal ?? 'tage',
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function createEosIssue(input: {
  entityId: string;
  profileId: string;
  title: string;
  detail?: string | null;
  priority?: 'low' | 'medium' | 'high';
  sourcePortal?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: 'Title required.' };
  const entityId = normalizeEntityId(input.entityId);
  if (!entityId || entityId === CONSOLIDATED_SELECT_VALUE) {
    return { ok: false, error: 'Pick a company scope to raise an issue.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('os_eos_issues').insert({
    entity_id: entityId,
    title,
    detail: input.detail?.trim() || null,
    scope: 'company',
    status: 'open',
    priority: input.priority ?? 'medium',
    owner_profile_id: input.profileId,
    raised_by_profile_id: input.profileId,
    source_portal: input.sourcePortal ?? 'tage',
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function createEosTodo(input: {
  entityId: string;
  profileId: string;
  title: string;
  sourcePortal?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: 'Title required.' };
  const entityId = normalizeEntityId(input.entityId);
  if (!entityId || entityId === CONSOLIDATED_SELECT_VALUE) {
    return { ok: false, error: 'Pick a company scope to add a to-do.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('os_eos_todos').insert({
    entity_id: entityId,
    title,
    status: 'open',
    assignee_profile_id: input.profileId,
    source_portal: input.sourcePortal ?? 'tage',
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function completeEosTodo(
  todoId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('os_eos_todos')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', todoId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateEosRockStatus(
  id: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('os_eos_rocks')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateEosIssueStatus(
  id: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('os_eos_issues')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function upsertEosVto(input: {
  entityId: string;
  profileId: string;
  core_values?: string | null;
  core_focus?: string | null;
  ten_year_target?: string | null;
  three_year_picture?: string | null;
  one_year_plan?: string | null;
  marketing_strategy?: string | null;
  issues_list_notes?: string | null;
  sourcePortal?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const entityId = normalizeEntityId(input.entityId);
  if (!entityId || entityId === CONSOLIDATED_SELECT_VALUE) {
    return { ok: false, error: 'Pick a company scope to edit V/TO.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('os_eos_vto').upsert(
    {
      entity_id: entityId,
      core_values: input.core_values?.trim() || null,
      core_focus: input.core_focus?.trim() || null,
      ten_year_target: input.ten_year_target?.trim() || null,
      three_year_picture: input.three_year_picture?.trim() || null,
      one_year_plan: input.one_year_plan?.trim() || null,
      marketing_strategy: input.marketing_strategy?.trim() || null,
      issues_list_notes: input.issues_list_notes?.trim() || null,
      updated_by_profile_id: input.profileId,
      source_portal: input.sourcePortal ?? 'tage',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'entity_id' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function upsertEosScorecardActual(input: {
  entityId: string;
  metricKey: string;
  weekKey?: string;
  actual: number;
  goal?: number | null;
  unit?: string;
  profileId?: string;
  sourcePortal?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const entityId = normalizeEntityId(input.entityId);
  if (!entityId || entityId === CONSOLIDATED_SELECT_VALUE) {
    return { ok: false, error: 'Pick a company scope to update scorecard.' };
  }
  const weekKey = input.weekKey || weekKeyFromDate();
  const on_track =
    input.goal != null ? input.actual >= Number(input.goal) : null;
  const supabase = await createClient();
  const { error } = await supabase.from('os_eos_scorecard_entries').upsert(
    {
      entity_id: entityId,
      metric_key: input.metricKey,
      week_key: weekKey,
      actual: input.actual,
      goal: input.goal ?? null,
      unit: input.unit ?? 'count',
      scope: 'company',
      on_track,
      owner_profile_id: input.profileId ?? null,
      source_portal: input.sourcePortal ?? 'tage',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'entity_id,metric_key,week_key' },
  );
  // Expression unique index may not map to onConflict — fall back to manual
  if (error && /no unique|ON CONFLICT/i.test(error.message)) {
    const existing = await supabase
      .from('os_eos_scorecard_entries')
      .select('id')
      .eq('entity_id', entityId)
      .eq('metric_key', input.metricKey)
      .eq('week_key', weekKey)
      .is('owner_profile_id', null)
      .maybeSingle();
    if (existing.data?.id) {
      const upd = await supabase
        .from('os_eos_scorecard_entries')
        .update({
          actual: input.actual,
          goal: input.goal ?? null,
          on_track,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.data.id);
      if (upd.error) return { ok: false, error: upd.error.message };
      return { ok: true };
    }
    const ins = await supabase.from('os_eos_scorecard_entries').insert({
      entity_id: entityId,
      metric_key: input.metricKey,
      week_key: weekKey,
      actual: input.actual,
      goal: input.goal ?? null,
      unit: input.unit ?? 'count',
      scope: 'company',
      on_track,
      owner_profile_id: null,
      source_portal: input.sourcePortal ?? 'tage',
    });
    if (ins.error) return { ok: false, error: ins.error.message };
    return { ok: true };
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
