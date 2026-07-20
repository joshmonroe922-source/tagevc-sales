import { createPersistClient } from '@/lib/supabase/persist-client';
import type { ReDeal, ReTask } from '@/lib/types';

function reToRow(d: ReDeal) {
  return {
    id: d.id,
    re_id: d.re_id,
    asset_name: d.asset_name,
    route: d.route,
    asset_type: d.asset_type,
    market: d.market,
    source: d.source,
    stage: d.stage,
    priority: d.priority,
    sourcer: d.sourcer,
    ask_k: d.ask_k,
    offer_k: d.offer_k,
    noi_k: d.noi_k,
    cap_yield_signal: d.cap_yield_signal,
    next_action: d.next_action,
    next_action_date: d.next_action_date,
    notes: d.notes,
    outcome: d.outcome,
    entity_id: d.entity_id,
    handoff_id: d.handoff_id,
    created_at: d.created_at,
    updated_at: d.updated_at,
    archived_at: d.archived_at,
  };
}

function rowToRe(row: Record<string, unknown>): ReDeal {
  return {
    id: String(row.id),
    re_id: String(row.re_id),
    asset_name: String(row.asset_name),
    route: row.route as ReDeal['route'],
    asset_type: (row.asset_type as string | null) ?? null,
    market: (row.market as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    stage: row.stage as ReDeal['stage'],
    priority: row.priority as ReDeal['priority'],
    sourcer: (row.sourcer as string | null) ?? null,
    ask_k: row.ask_k == null ? null : Number(row.ask_k),
    offer_k: row.offer_k == null ? null : Number(row.offer_k),
    noi_k: row.noi_k == null ? null : Number(row.noi_k),
    cap_yield_signal: (row.cap_yield_signal as string | null) ?? null,
    next_action: (row.next_action as string | null) ?? null,
    next_action_date: (row.next_action_date as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    outcome: (row.outcome as ReDeal['outcome']) ?? null,
    entity_id: (row.entity_id as string | null) ?? null,
    handoff_id: (row.handoff_id as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    archived_at: (row.archived_at as string | null) ?? null,
  };
}

function taskToRow(task: ReTask) {
  return {
    id: task.id,
    task_id: task.task_id,
    re_id: task.re_id,
    asset_name: task.asset_name,
    route: task.route,
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

function rowToTask(row: Record<string, unknown>): ReTask {
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    re_id: String(row.re_id),
    asset_name: String(row.asset_name),
    route: row.route as ReTask['route'],
    process_stage: String(row.process_stage),
    title: String(row.title),
    priority: row.priority as ReTask['priority'],
    status: row.status as ReTask['status'],
    owner: (row.owner as string | null) ?? null,
    due_date: (row.due_date as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    lib_id: (row.lib_id as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at: (row.completed_at as string | null) ?? null,
  };
}

export async function fetchAllReDeals(): Promise<ReDeal[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_re_deals')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('fetchAllReDeals', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToRe(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllReDeals', e);
    return null;
  }
}

export async function fetchAllReTasks(): Promise<ReTask[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_re_tasks')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('fetchAllReTasks', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToTask(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllReTasks', e);
    return null;
  }
}

export async function syncReDealsAndTasks(
  deals: ReDeal[],
  tasks: ReTask[],
): Promise<boolean> {
  try {
    const supabase = await createPersistClient();
    if (deals.length > 0) {
      const { error } = await supabase
        .from('os_re_deals')
        .upsert(deals.map(reToRow), { onConflict: 're_id' });
      if (error) {
        console.error('syncReDealsAndTasks deals', error.message);
        return false;
      }
    }
    if (tasks.length > 0) {
      const { error } = await supabase
        .from('os_re_tasks')
        .upsert(tasks.map(taskToRow), { onConflict: 'task_id' });
      if (error) {
        console.error('syncReDealsAndTasks tasks', error.message);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.error('syncReDealsAndTasks', e);
    return false;
  }
}
