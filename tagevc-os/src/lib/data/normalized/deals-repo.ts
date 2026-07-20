import { createPersistClient } from '@/lib/supabase/persist-client';
import type { Deal, DealTask } from '@/lib/types';

function dealToRow(deal: Deal) {
  return {
    id: deal.id,
    deal_id: deal.deal_id,
    lead_id: deal.lead_id,
    company_name: deal.company_name,
    entity_id: deal.entity_id,
    exec_stage: deal.exec_stage,
    priority: deal.priority,
    instrument: deal.instrument,
    premoney_m: deal.premoney_m,
    check_k: deal.check_k,
    ownership_pct: deal.ownership_pct,
    counsel: deal.counsel,
    path: deal.path,
    outcome: deal.outcome,
    owner: deal.owner,
    next_action: deal.next_action,
    handoff_id: deal.handoff_id,
    created_at: deal.created_at,
    updated_at: deal.updated_at,
    archived_at: deal.archived_at,
  };
}

function rowToDeal(row: Record<string, unknown>): Deal {
  return {
    id: String(row.id),
    deal_id: String(row.deal_id),
    lead_id: (row.lead_id as string | null) ?? null,
    company_name: String(row.company_name),
    entity_id: (row.entity_id as string | null) ?? null,
    exec_stage: row.exec_stage as Deal['exec_stage'],
    priority: row.priority as Deal['priority'],
    instrument: (row.instrument as string | null) ?? null,
    premoney_m: row.premoney_m == null ? null : Number(row.premoney_m),
    check_k: row.check_k == null ? null : Number(row.check_k),
    ownership_pct:
      row.ownership_pct == null ? null : Number(row.ownership_pct),
    counsel: (row.counsel as string | null) ?? null,
    path: (row.path as Deal['path']) ?? null,
    outcome: (row.outcome as Deal['outcome']) ?? null,
    owner: (row.owner as string | null) ?? null,
    next_action: (row.next_action as string | null) ?? null,
    handoff_id: (row.handoff_id as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    archived_at: (row.archived_at as string | null) ?? null,
  };
}

function taskToRow(task: DealTask) {
  return {
    id: task.id,
    task_id: task.task_id,
    deal_id: task.deal_id,
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

function rowToTask(row: Record<string, unknown>): DealTask {
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    deal_id: String(row.deal_id),
    company_name: String(row.company_name),
    process_stage: String(row.process_stage),
    title: String(row.title),
    priority: row.priority as DealTask['priority'],
    status: row.status as DealTask['status'],
    owner: (row.owner as string | null) ?? null,
    due_date: (row.due_date as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    lib_id: (row.lib_id as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at: (row.completed_at as string | null) ?? null,
  };
}

export async function fetchAllDeals(): Promise<Deal[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_deals')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('fetchAllDeals', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToDeal(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllDeals', e);
    return null;
  }
}

export async function fetchAllDealTasks(): Promise<DealTask[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_deal_tasks')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('fetchAllDealTasks', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToTask(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllDealTasks', e);
    return null;
  }
}

export async function syncDealsAndTasks(
  deals: Deal[],
  tasks: DealTask[],
): Promise<boolean> {
  try {
    const supabase = await createPersistClient();
    if (deals.length > 0) {
      const { error } = await supabase
        .from('os_deals')
        .upsert(deals.map(dealToRow), { onConflict: 'deal_id' });
      if (error) {
        console.error('syncDealsAndTasks deals', error.message);
        return false;
      }
    }
    if (tasks.length > 0) {
      const { error } = await supabase
        .from('os_deal_tasks')
        .upsert(tasks.map(taskToRow), { onConflict: 'task_id' });
      if (error) {
        console.error('syncDealsAndTasks tasks', error.message);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.error('syncDealsAndTasks', e);
    return false;
  }
}
