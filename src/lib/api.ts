import { requireSupabase, supabase } from './supabase';
import { TEXT_SEARCH_OPTS, searchLimit, toWebsearchQuery } from './textSearch';
import type {
  CreateTaskResult,
  DealPath,
  LeadActivity,
  LeadSource,
  LeadStage,
  SalesLead,
  SalesTask,
  TaskImportance,
  TaskStatus,
} from './types';

const LEAD_SELECT =
  'id, name, email, phone, company, deal_path, source, stage, notes, assigned_rep_id, next_action_at, closed_at, created_at, updated_at, contact_id, account_id, sales_contacts(id, full_name, primary_email, primary_phone, company, title, account_id), sales_accounts(id, name, account_type, website)';

export async function listLeads(opts?: {
  q?: string;
  limit?: number;
}): Promise<SalesLead[]> {
  const fts = toWebsearchQuery(opts?.q ?? '');
  let query = requireSupabase()
    .from('sales_leads')
    .select(LEAD_SELECT)
    .order('created_at', { ascending: false })
    .limit(searchLimit(opts?.limit, Boolean(fts)));

  if (fts) {
    query = query.textSearch('search_vector', fts, TEXT_SEARCH_OPTS);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as SalesLead[];
}

export async function getLead(id: string): Promise<SalesLead | null> {
  const { data, error } = await requireSupabase()
    .from('sales_leads')
    .select(LEAD_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as SalesLead | null;
}

export type CreateLeadInput = {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  /** Required for new deals — pick/create a contact first. */
  contact_id: string;
  /** Strongly preferred — from contact.account_id or explicit picker. */
  account_id?: string | null;
  deal_path?: DealPath;
  source?: LeadSource;
  notes?: string;
  stage?: LeadStage;
  next_action_at?: string | null;
  assigned_rep_id?: string | null;
};

export async function createLead(input: CreateLeadInput): Promise<SalesLead> {
  if (!input.contact_id) {
    throw new Error('A contact is required to create a deal');
  }
  const client = requireSupabase();
  const { data, error } = await client
    .from('sales_leads')
    .insert({
      name: input.name.trim(),
      email: (input.email ?? '').trim().toLowerCase(),
      phone: (input.phone ?? '').trim(),
      company: (input.company ?? '').trim(),
      contact_id: input.contact_id,
      account_id: input.account_id ?? null,
      deal_path: input.deal_path ?? 'launch',
      source: input.source ?? 'manual',
      notes: input.notes ?? '',
      stage: input.stage ?? 'new',
      next_action_at: input.next_action_at ?? null,
      assigned_rep_id: input.assigned_rep_id ?? null,
    })
    .select(LEAD_SELECT)
    .single();
  if (error) throw error;

  await client.from('sales_lead_activities').insert({
    lead_id: data.id,
    contact_id: input.contact_id,
    activity_type: 'system',
    summary: 'Lead created manually',
    created_by: input.assigned_rep_id ?? null,
  });

  // Enroll New leads in nurture drip (best-effort; intake edge fn does the same)
  if ((input.stage ?? 'new') === 'new') {
    const { data: seq } = await client
      .from('sales_drip_sequences')
      .select('id')
      .eq('slug', 'new-lead-nurture')
      .eq('active', true)
      .maybeSingle();
    if (seq) {
      await client.from('sales_drip_enrollments').upsert(
        {
          sequence_id: seq.id,
          lead_id: data.id,
          owner_id: input.assigned_rep_id ?? null,
          status: 'active',
          current_step: 0,
          next_send_at: new Date().toISOString(),
        },
        { onConflict: 'sequence_id,lead_id' },
      );
      await client.from('sales_lead_activities').insert({
        lead_id: data.id,
        contact_id: input.contact_id,
        activity_type: 'drip_enrolled',
        summary: 'Enrolled in new-lead-nurture',
        created_by: input.assigned_rep_id ?? null,
      });
    }
  }

  return data as SalesLead;
}

export async function updateLeadViaEdge(
  leadId: string,
  patch: Partial<CreateLeadInput> & { stage?: LeadStage },
): Promise<SalesLead> {
  if (!supabase) throw new Error('Supabase is not configured');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-lead`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ lead_id: leadId, ...patch }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? 'Failed to update lead');
  }
  return body.lead as SalesLead;
}

export async function listTasks(opts?: {
  status?: TaskStatus;
  leadId?: string;
}): Promise<SalesTask[]> {
  let q = requireSupabase()
    .from('sales_tasks')
    .select('*, sales_leads(id, name, company)')
    .order('due_at', { ascending: true, nullsFirst: false });

  if (opts?.status) q = q.eq('status', opts.status);
  if (opts?.leadId) q = q.eq('lead_id', opts.leadId);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SalesTask[];
}

/** Next open sales_tasks row per lead (earliest due_at). One query for the deal board. */
export async function mapNextOpenFollowUpByLead(): Promise<Record<string, SalesTask>> {
  const tasks = await listTasks({ status: 'open' });
  const map: Record<string, SalesTask> = {};
  for (const task of tasks) {
    const leadId = task.lead_id?.trim();
    if (!leadId || map[leadId]) continue;
    map[leadId] = task;
  }
  return map;
}

export const SALES_TODO_SAVED_EVENT = 'sales-todo-saved';

export function notifySalesTodoSaved(): void {
  window.dispatchEvent(new CustomEvent(SALES_TODO_SAVED_EVENT));
}

export async function createTask(input: {
  sales_user_id: string;
  title: string;
  notes?: string;
  due_at?: string | null;
  lead_id?: string | null;
  /** undefined → deal-sourcing; null or 'personal' → Tage · Personal (unscoped). */
  portal_slug?: string | null;
  importance?: TaskImportance | string | null;
  sync_ms_todo?: boolean;
}): Promise<CreateTaskResult> {
  const client = requireSupabase();
  const importanceRaw = (input.importance ?? 'normal').toString().toLowerCase();
  const importance: TaskImportance =
    importanceRaw === 'low' || importanceRaw === 'high' || importanceRaw === 'normal'
      ? importanceRaw
      : 'normal';

  let portalSlug: string | null;
  if (input.portal_slug === undefined) {
    portalSlug = 'deal-sourcing';
  } else if (input.portal_slug === null || input.portal_slug === 'personal') {
    portalSlug = 'personal';
  } else {
    portalSlug = input.portal_slug;
  }

  const row = {
    sales_user_id: input.sales_user_id,
    title: input.title.trim(),
    notes: input.notes ?? '',
    due_at: input.due_at ?? null,
    lead_id: input.lead_id ?? null,
    portal_slug: portalSlug,
    importance,
    status: 'open' as const,
  };

  let data: SalesTask | null = null;
  {
    const first = await client
      .from('sales_tasks')
      .insert(row)
      .select('*, sales_leads(id, name, company)')
      .single();
    if (first.error && /portal_slug|ms_todo|importance/i.test(first.error.message)) {
      const { portal_slug: _p, importance: _i, ...legacy } = row;
      const second = await client
        .from('sales_tasks')
        .insert(legacy)
        .select('*, sales_leads(id, name, company)')
        .single();
      if (second.error) throw second.error;
      data = second.data as SalesTask;
    } else if (first.error) {
      throw first.error;
    } else {
      data = first.data as SalesTask;
    }
  }

  if (input.lead_id) {
    await client.from('sales_lead_activities').insert({
      lead_id: input.lead_id,
      activity_type: 'task_created',
      summary: `Task: ${input.title.trim()}`,
      created_by: input.sales_user_id,
    });
  }

  let task = data as SalesTask;
  if (input.sync_ms_todo === false) {
    return { task, synced: false, syncError: undefined };
  }

  const { syncFollowUpCreatedToMs } = await import('./portalTodoSync');
  const sync = await syncFollowUpCreatedToMs(task);
  return {
    task: sync.task,
    synced: sync.synced,
    syncError: sync.syncError,
  };
}

/** Map Microsoft To Do task ids → deal cards for “Open deal” links. */
export async function listTodoLeadLinks(): Promise<
  Record<string, { lead_id: string; label: string }>
> {
  const { data, error } = await requireSupabase()
    .from('sales_tasks')
    .select('ms_todo_task_id, lead_id, sales_leads(id, name, company)')
    .not('ms_todo_task_id', 'is', null)
    .not('lead_id', 'is', null);
  if (error) throw error;

  const out: Record<string, { lead_id: string; label: string }> = {};
  for (const row of data ?? []) {
    const taskId = (row.ms_todo_task_id as string | null)?.trim();
    const leadId = (row.lead_id as string | null)?.trim();
    if (!taskId || !leadId) continue;
    const leadRaw = row.sales_leads as unknown;
    const lead = (Array.isArray(leadRaw) ? leadRaw[0] : leadRaw) as
      | { id: string; name: string; company: string | null }
      | null
      | undefined;
    const label = lead?.name
      ? lead.company
        ? `${lead.name} · ${lead.company}`
        : lead.name
      : 'Open deal';
    out[taskId] = { lead_id: leadId, label };
  }
  return out;
}

/**
 * Persist (or clear) the deal card linked to a Microsoft To Do task so “Open deal” works.
 * Creates/updates a sales_tasks row keyed by ms_todo_task_id.
 */
export async function linkMsTodoToLead(input: {
  sales_user_id: string;
  ms_todo_list_id: string;
  ms_todo_task_id: string;
  title: string;
  due_at?: string | null;
  importance?: TaskImportance | string | null;
  portal_slug?: string | null;
  lead_id: string | null;
}): Promise<void> {
  const client = requireSupabase();
  const taskId = input.ms_todo_task_id.trim();
  if (!taskId) return;

  const importanceRaw = (input.importance ?? 'normal').toString().toLowerCase();
  const importance: TaskImportance =
    importanceRaw === 'low' || importanceRaw === 'high' || importanceRaw === 'normal'
      ? importanceRaw
      : 'normal';

  const portalSlug =
    input.portal_slug === null || input.portal_slug === 'personal'
      ? 'personal'
      : input.portal_slug === 'master'
        ? 'master'
        : (input.portal_slug ?? (input.lead_id ? 'deal-sourcing' : 'personal'));

  const { data: existing } = await client
    .from('sales_tasks')
    .select('id')
    .eq('ms_todo_task_id', taskId)
    .maybeSingle();

  if (existing?.id) {
    const patch: Record<string, unknown> = {
      lead_id: input.lead_id,
      title: input.title.trim(),
      importance,
      portal_slug: portalSlug,
      ms_todo_list_id: input.ms_todo_list_id,
      ms_todo_task_id: taskId,
    };
    if (input.due_at !== undefined) {
      patch.due_at = input.due_at;
    }
    const { error } = await client.from('sales_tasks').update(patch).eq('id', existing.id);
    if (error) throw error;
    return;
  }

  if (!input.lead_id) return;

  const { error } = await client.from('sales_tasks').insert({
    sales_user_id: input.sales_user_id,
    title: input.title.trim(),
    notes: '',
    due_at: input.due_at ?? null,
    lead_id: input.lead_id,
    portal_slug: portalSlug,
    importance,
    status: 'open',
    ms_todo_list_id: input.ms_todo_list_id,
    ms_todo_task_id: taskId,
  });
  if (error) throw error;
}

export async function setTaskStatus(
  taskId: string,
  status: TaskStatus,
): Promise<void> {
  const client = requireSupabase();
  const { data: existing } = await client
    .from('sales_tasks')
    .select('ms_todo_list_id, ms_todo_task_id, portal_slug')
    .eq('id', taskId)
    .maybeSingle();

  const { error } = await client
    .from('sales_tasks')
    .update({
      status,
      completed_at: status === 'done' ? new Date().toISOString() : null,
    })
    .eq('id', taskId);
  if (error) throw error;

  if (existing) {
    const { syncFollowUpStatusToMs } = await import('./portalTodoSync');
    await syncFollowUpStatusToMs(
      existing as Pick<
        SalesTask,
        'ms_todo_list_id' | 'ms_todo_task_id' | 'portal_slug'
      >,
      status,
    );
  }
}

export async function listActivities(leadId: string): Promise<LeadActivity[]> {
  const { data, error } = await requireSupabase()
    .from('sales_lead_activities')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as LeadActivity[];
}

export async function addLeadNote(
  leadId: string,
  summary: string,
  createdBy: string,
): Promise<void> {
  const client = requireSupabase();
  const { data: lead } = await client
    .from('sales_leads')
    .select('notes, contact_id')
    .eq('id', leadId)
    .single();
  await client.from('sales_lead_activities').insert({
    lead_id: leadId,
    contact_id: lead?.contact_id ?? null,
    activity_type: 'note',
    summary,
    created_by: createdBy,
  });
  const existing = lead?.notes?.trim() ? `${lead.notes.trim()}\n\n` : '';
  await client
    .from('sales_leads')
    .update({ notes: `${existing}${summary}` })
    .eq('id', leadId);
}

export async function listDripSequences() {
  const { data, error } = await requireSupabase()
    .from('sales_drip_sequences')
    .select('*, sales_drip_steps(*)')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listDripEnrollments() {
  const { data, error } = await requireSupabase()
    .from('sales_drip_enrollments')
    .select('*, sales_leads(id, name, company), sales_drip_sequences(name, slug)')
    .order('enrolled_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function runDripsNow(): Promise<{ processed: number; errors: string[] }> {
  if (!supabase) throw new Error('Supabase is not configured');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-drips`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? 'Failed to process drips');
  return { processed: body.processed ?? 0, errors: body.errors ?? [] };
}

export async function sendTrackedEmail(input: {
  leadId: string;
  to?: string;
  subject: string;
  html: string;
}): Promise<{
  message_id: string | null;
  tracking_token: string;
  from: string;
  to: string;
  subject: string;
}> {
  if (!supabase) throw new Error('Supabase is not configured');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-tracked-email`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      lead_id: input.leadId,
      to: input.to,
      subject: input.subject,
      html: input.html,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? 'Failed to send tracked email');
  return {
    message_id: (body.message_id as string | null) ?? null,
    tracking_token: body.tracking_token as string,
    from: body.from as string,
    to: body.to as string,
    subject: body.subject as string,
  };
}
