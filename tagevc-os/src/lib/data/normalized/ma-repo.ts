import { createPersistClient } from '@/lib/supabase/persist-client';
import type { MaTarget, MaTask } from '@/lib/types';

function maToRow(t: MaTarget) {
  return {
    id: t.id,
    ma_id: t.ma_id,
    company_name: t.company_name,
    website: t.website,
    sector: t.sector,
    deal_type: t.deal_type,
    source: t.source,
    stage: t.stage,
    priority: t.priority,
    owner: t.owner,
    enterprise_value_m: t.enterprise_value_m,
    revenue_m: t.revenue_m,
    ebitda_m: t.ebitda_m,
    next_action: t.next_action,
    next_action_date: t.next_action_date,
    exclusivity_end: t.exclusivity_end,
    strategic_fit: t.strategic_fit,
    notes: t.notes,
    outcome: t.outcome,
    entity_id: t.entity_id,
    handoff_id: t.handoff_id,
    created_at: t.created_at,
    updated_at: t.updated_at,
    archived_at: t.archived_at,
  };
}

function rowToMa(row: Record<string, unknown>): MaTarget {
  return {
    id: String(row.id),
    ma_id: String(row.ma_id),
    company_name: String(row.company_name),
    website: (row.website as string | null) ?? null,
    sector: (row.sector as string | null) ?? null,
    deal_type: (row.deal_type as MaTarget['deal_type']) ?? null,
    source: (row.source as string | null) ?? null,
    stage: row.stage as MaTarget['stage'],
    priority: row.priority as MaTarget['priority'],
    owner: (row.owner as string | null) ?? null,
    enterprise_value_m:
      row.enterprise_value_m == null ? null : Number(row.enterprise_value_m),
    revenue_m: row.revenue_m == null ? null : Number(row.revenue_m),
    ebitda_m: row.ebitda_m == null ? null : Number(row.ebitda_m),
    next_action: (row.next_action as string | null) ?? null,
    next_action_date: (row.next_action_date as string | null) ?? null,
    exclusivity_end: (row.exclusivity_end as string | null) ?? null,
    strategic_fit: (row.strategic_fit as MaTarget['strategic_fit']) ?? null,
    notes: (row.notes as string | null) ?? null,
    outcome: (row.outcome as MaTarget['outcome']) ?? null,
    entity_id: (row.entity_id as string | null) ?? null,
    handoff_id: (row.handoff_id as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    archived_at: (row.archived_at as string | null) ?? null,
  };
}

function taskToRow(task: MaTask) {
  return {
    id: task.id,
    task_id: task.task_id,
    ma_id: task.ma_id,
    company_name: task.company_name,
    process_stage: task.process_stage,
    title: task.title,
    priority: task.priority,
    status: task.status,
    owner: task.owner,
    due_date: task.due_date,
    notes: task.notes,
    lib_id: task.lib_id,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at,
  };
}

function rowToTask(row: Record<string, unknown>): MaTask {
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    ma_id: String(row.ma_id),
    company_name: String(row.company_name),
    process_stage: String(row.process_stage),
    title: String(row.title),
    priority: row.priority as MaTask['priority'],
    status: row.status as MaTask['status'],
    owner: (row.owner as string | null) ?? null,
    due_date: (row.due_date as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    lib_id: (row.lib_id as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at: (row.completed_at as string | null) ?? null,
  };
}

export async function fetchAllMaTargets(): Promise<MaTarget[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_ma_targets')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('fetchAllMaTargets', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToMa(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllMaTargets', e);
    return null;
  }
}

export async function fetchAllMaTasks(): Promise<MaTask[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_ma_tasks')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('fetchAllMaTasks', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToTask(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllMaTasks', e);
    return null;
  }
}

export async function syncMaTargetsAndTasks(
  targets: MaTarget[],
  tasks: MaTask[],
): Promise<boolean> {
  try {
    const supabase = await createPersistClient();
    if (targets.length > 0) {
      const { error } = await supabase
        .from('os_ma_targets')
        .upsert(targets.map(maToRow), { onConflict: 'ma_id' });
      if (error) {
        console.error('syncMaTargetsAndTasks targets', error.message);
        return false;
      }
    }
    if (tasks.length > 0) {
      const { error } = await supabase
        .from('os_ma_tasks')
        .upsert(tasks.map(taskToRow), { onConflict: 'task_id' });
      if (error) {
        console.error('syncMaTargetsAndTasks tasks', error.message);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.error('syncMaTargetsAndTasks', e);
    return false;
  }
}
