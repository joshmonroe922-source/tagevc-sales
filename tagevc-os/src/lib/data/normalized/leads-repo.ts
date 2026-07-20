import { createPersistClient } from '@/lib/supabase/persist-client';
import type { Lead, LeadTask } from '@/lib/types';

function leadToRow(lead: Lead) {
  return {
    id: lead.id,
    lead_id: lead.lead_id,
    company_name: lead.company_name,
    website: lead.website,
    sector: lead.sector,
    source: lead.source,
    source_detail: lead.source_detail,
    stage: lead.stage,
    priority: lead.priority,
    owner: lead.owner,
    next_action: lead.next_action,
    next_action_date: lead.next_action_date,
    thesis_fit: lead.thesis_fit,
    score: lead.score,
    raise_stage: lead.raise_stage,
    check_size_k: lead.check_size_k,
    location: lead.location,
    path: lead.path,
    notes: lead.notes,
    outcome: lead.outcome,
    deal_id: lead.deal_id,
    related_entity_id: lead.related_entity_id,
    created_at: lead.created_at,
    updated_at: lead.updated_at,
    archived_at: lead.archived_at,
  };
}

function rowToLead(row: Record<string, unknown>): Lead {
  return {
    id: String(row.id),
    lead_id: String(row.lead_id),
    company_name: String(row.company_name),
    website: (row.website as string | null) ?? null,
    sector: (row.sector as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    source_detail: (row.source_detail as string | null) ?? null,
    stage: row.stage as Lead['stage'],
    priority: row.priority as Lead['priority'],
    owner: (row.owner as string | null) ?? null,
    next_action: (row.next_action as string | null) ?? null,
    next_action_date: (row.next_action_date as string | null) ?? null,
    thesis_fit: (row.thesis_fit as Lead['thesis_fit']) ?? null,
    score: row.score == null ? null : Number(row.score),
    raise_stage: (row.raise_stage as string | null) ?? null,
    check_size_k: row.check_size_k == null ? null : Number(row.check_size_k),
    location: (row.location as string | null) ?? null,
    path: (row.path as Lead['path']) ?? null,
    notes: (row.notes as string | null) ?? null,
    outcome: (row.outcome as Lead['outcome']) ?? null,
    deal_id: (row.deal_id as string | null) ?? null,
    related_entity_id: (row.related_entity_id as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    archived_at: (row.archived_at as string | null) ?? null,
  };
}

function taskToRow(task: LeadTask) {
  return {
    id: task.id,
    task_id: task.task_id,
    lead_id: task.lead_id,
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

function rowToTask(row: Record<string, unknown>): LeadTask {
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    lead_id: String(row.lead_id),
    company_name: String(row.company_name),
    process_stage: String(row.process_stage),
    title: String(row.title),
    priority: row.priority as LeadTask['priority'],
    status: row.status as LeadTask['status'],
    owner: (row.owner as string | null) ?? null,
    due_date: (row.due_date as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    lib_id: (row.lib_id as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at: (row.completed_at as string | null) ?? null,
  };
}

/** Returns null if table missing / error; empty array if ready but empty. */
export async function fetchAllLeads(): Promise<Lead[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_leads')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('fetchAllLeads', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToLead(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllLeads', e);
    return null;
  }
}

export async function fetchAllLeadTasks(): Promise<LeadTask[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_lead_tasks')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('fetchAllLeadTasks', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToTask(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllLeadTasks', e);
    return null;
  }
}

/** Upsert leads then tasks (tasks require lead_id FK). */
export async function syncLeadsAndTasks(
  leads: Lead[],
  tasks: LeadTask[],
): Promise<boolean> {
  try {
    const supabase = await createPersistClient();
    if (leads.length > 0) {
      const { error } = await supabase
        .from('os_leads')
        .upsert(leads.map(leadToRow), { onConflict: 'lead_id' });
      if (error) {
        console.error('syncLeadsAndTasks leads', error.message);
        return false;
      }
    }
    if (tasks.length > 0) {
      const { error } = await supabase
        .from('os_lead_tasks')
        .upsert(tasks.map(taskToRow), { onConflict: 'task_id' });
      if (error) {
        console.error('syncLeadsAndTasks tasks', error.message);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.error('syncLeadsAndTasks', e);
    return false;
  }
}
