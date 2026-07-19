import { createTask } from './api';
import { logAuditCompletion, logAuditEvent } from './audit';
import { todayDateString } from './auditControlUtils';
import { formatDate } from './types';
import { listEntities } from './opsApi';
import { requireSupabase } from './supabase';
import type {
  TechnologyComplianceCadence,
  TechnologyControl,
  TechnologyControlSource,
  TechnologyControlStatus,
  TechnologyTask,
  TechnologyTaskStatus,
} from './technologyTypes';

export { formatDate };

const AUDIT_EVIDENCE_BUCKET = 'audit-evidence';

export async function listTechnologyEntities() {
  return listEntities();
}

export async function listTechnologyControls(opts?: {
  entityId?: string | 'parent' | 'all';
  area?: string | 'all';
  source?: TechnologyControlSource | 'all';
  status?: TechnologyControlStatus | 'all';
}): Promise<TechnologyControl[]> {
  const sb = requireSupabase();
  let query = sb
    .from('technology_controls')
    .select('*, ops_entities(id, name)')
    .eq('active', true)
    .order('area', { ascending: true })
    .order('title', { ascending: true });

  if (opts?.entityId === 'parent') {
    query = query.is('entity_id', null);
  } else if (opts?.entityId && opts.entityId !== 'all') {
    query = query.eq('entity_id', opts.entityId);
  }
  if (opts?.area && opts.area !== 'all') {
    query = query.eq('area', opts.area);
  }
  if (opts?.source && opts.source !== 'all') {
    query = query.eq('source', opts.source);
  }
  if (opts?.status && opts.status !== 'all') {
    query = query.eq('status', opts.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as TechnologyControl[];
}

export async function createTechnologyControl(input: {
  title: string;
  description?: string;
  entity_id?: string | null;
  control_key?: string;
  area?: string;
  document_kind?: string;
  evidence_expectation?: string;
  source?: TechnologyControlSource;
  applies_to_parent?: boolean;
  applies_to_entities?: boolean;
  cadence?: TechnologyComplianceCadence;
  owner_role?: string;
  next_due_at?: string | null;
  notes?: string;
  evidence_notes?: string;
  created_by?: string | null;
}): Promise<TechnologyControl> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('technology_controls')
    .insert({
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      entity_id: input.entity_id || null,
      control_key: input.control_key?.trim() ?? '',
      area: input.area?.trim() || 'General',
      document_kind: input.document_kind ?? 'RECORDS',
      evidence_expectation: input.evidence_expectation?.trim() ?? '',
      source: input.source ?? 'manual',
      applies_to_parent: input.applies_to_parent ?? true,
      applies_to_entities: input.applies_to_entities ?? true,
      cadence: input.cadence ?? 'annual',
      owner_role: input.owner_role?.trim() || 'Technology',
      next_due_at: input.next_due_at || null,
      notes: input.notes?.trim() ?? '',
      evidence_notes: input.evidence_notes?.trim() ?? '',
      created_by: input.created_by ?? null,
    })
    .select('*, ops_entities(id, name)')
    .single();
  if (error) throw error;
  return data as TechnologyControl;
}

export async function updateTechnologyControl(
  id: string,
  patch: Partial<{
    title: string;
    description: string;
    status: TechnologyControlStatus;
    owner_role: string;
    next_due_at: string | null;
    last_reviewed_at: string | null;
    evidence_url: string;
    evidence_notes: string;
    evidence_storage_path: string;
    evidence_file_name: string;
    evidence_mime_type: string;
    notes: string;
    active: boolean;
    cadence: TechnologyComplianceCadence;
  }>,
): Promise<TechnologyControl> {
  const sb = requireSupabase();
  let fromStatus: string | null = null;
  let title: string | null = null;
  if (patch.status !== undefined) {
    const { data: prev } = await sb
      .from('technology_controls')
      .select('status, title')
      .eq('id', id)
      .maybeSingle();
    fromStatus = (prev?.status as string | undefined) ?? null;
    title = (prev?.title as string | undefined) ?? null;
  }
  const { data, error } = await sb
    .from('technology_controls')
    .update(patch)
    .eq('id', id)
    .select('*, ops_entities(id, name)')
    .single();
  if (error) throw error;
  const row = data as TechnologyControl;
  if (patch.status !== undefined && fromStatus !== patch.status) {
    logAuditCompletion({
      eventType:
        patch.status === 'compliant' ? 'audit_control_reviewed' : 'audit_control_status',
      portal: 'technology',
      entityType: 'technology_control',
      entityId: id,
      title: title ?? row.title,
      fromStatus,
      toStatus: patch.status,
      completedAt:
        patch.last_reviewed_at ??
        (patch.status === 'compliant' ? todayDateString() : null),
    });
  }
  return row;
}

/**
 * Mark reviewed: sets last_reviewed_at, rolls next_due_at by cadence (review frequency),
 * marks status compliant, and closes linked open technology_tasks.
 */
export async function markTechnologyControlReviewed(
  id: string,
  reviewedBy?: string | null,
): Promise<TechnologyControl> {
  const sb = requireSupabase();
  const { data: prev } = await sb
    .from('technology_controls')
    .select('status, title')
    .eq('id', id)
    .maybeSingle();
  const { error } = await sb.rpc('mark_technology_control_reviewed', {
    p_control_id: id,
    p_reviewed_by: reviewedBy ?? null,
  });
  if (error) throw error;
  // Re-fetch with entity join for UI
  const { data: full, error: getErr } = await sb
    .from('technology_controls')
    .select('*, ops_entities(id, name)')
    .eq('id', id)
    .single();
  if (getErr) throw getErr;
  const control = full as TechnologyControl;
  logAuditCompletion({
    eventType: 'audit_control_reviewed',
    portal: 'technology',
    entityType: 'technology_control',
    entityId: id,
    title: (prev?.title as string | undefined) ?? control.title,
    fromStatus: (prev?.status as string | undefined) ?? null,
    toStatus: 'compliant',
    completedAt: control.last_reviewed_at,
  });
  return control;
}

export type UploadTechnologyEvidenceResult =
  | { ok: true; control: TechnologyControl }
  | { ok: false; reason: 'storage_unavailable' | 'error'; message: string };

/** Attach evidence file to a technology control (storage bucket audit-evidence). */
export async function uploadTechnologyControlEvidence(input: {
  control: TechnologyControl;
  file: File;
}): Promise<UploadTechnologyEvidenceResult> {
  const client = requireSupabase();
  const safeName = input.file.name.replace(/[^\w.\-]+/g, '_');
  const scope = input.control.entity_id ?? 'parent';
  const path = `technology/${scope}/${input.control.id}/${Date.now()}_${safeName}`;

  const { error: upErr } = await client.storage
    .from(AUDIT_EVIDENCE_BUCKET)
    .upload(path, input.file, {
      contentType: input.file.type || 'application/octet-stream',
      upsert: false,
    });

  if (upErr) {
    const msg = upErr.message || String(upErr);
    const unavailable =
      /bucket|not found|does not exist|row-level security|403|404/i.test(msg);
    return {
      ok: false,
      reason: unavailable ? 'storage_unavailable' : 'error',
      message: msg,
    };
  }

  try {
    const control = await updateTechnologyControl(input.control.id, {
      evidence_storage_path: path,
      evidence_file_name: input.file.name,
      evidence_mime_type: input.file.type || '',
    });
    return { ok: true, control };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getTechnologyEvidenceSignedUrl(
  storagePath: string,
  expiresIn = 3600,
): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await requireSupabase()
    .storage.from(AUDIT_EVIDENCE_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error) return null;
  if (data.signedUrl) {
    void logAuditEvent({
      eventType: 'download',
      metadata: {
        destination_url: data.signedUrl.split('?')[0],
        storage_path: storagePath,
        kind: 'signed_url',
        bucket: AUDIT_EVIDENCE_BUCKET,
      },
    });
  }
  return data.signedUrl ?? null;
}

export function isTechnologyControlOverdue(c: TechnologyControl): boolean {
  if (!c.next_due_at || c.status === 'na') return false;
  // Compliant stays overdue-capable once next_due_at arrives (reopened by task sync)
  if (c.status === 'compliant' && c.next_due_at >= new Date().toISOString().slice(0, 10)) {
    return false;
  }
  return c.next_due_at < new Date().toISOString().slice(0, 10);
}

export function isTechnologyControlIncomplete(c: TechnologyControl): boolean {
  return c.active && (c.status === 'open' || c.status === 'in_progress' || c.status === 'gap');
}

export async function listTechnologyTasks(opts?: {
  status?: TechnologyTaskStatus | 'all';
}): Promise<TechnologyTask[]> {
  const sb = requireSupabase();
  let query = sb
    .from('technology_tasks')
    .select(
      '*, technology_controls(id, title, area, status, control_key, entity_id, ops_entities(id, name))',
    )
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (opts?.status && opts.status !== 'all') {
    query = query.eq('status', opts.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as TechnologyTask[];
}

export async function updateTechnologyTask(
  id: string,
  patch: Partial<{
    status: TechnologyTaskStatus;
    assigned_to: string | null;
    due_at: string | null;
    notes: string;
    sales_task_id: string | null;
    title: string;
    completed_at: string | null;
  }>,
): Promise<TechnologyTask> {
  const sb = requireSupabase();
  const finalPatch: typeof patch = { ...patch };
  if (patch.status === 'done' && finalPatch.completed_at === undefined) {
    finalPatch.completed_at = new Date().toISOString();
  } else if (
    patch.status &&
    patch.status !== 'done' &&
    finalPatch.completed_at === undefined
  ) {
    finalPatch.completed_at = null;
  }

  let fromStatus: string | null = null;
  let title: string | null = null;
  if (patch.status !== undefined) {
    const { data: prev } = await sb
      .from('technology_tasks')
      .select('status, title')
      .eq('id', id)
      .maybeSingle();
    fromStatus = (prev?.status as string | undefined) ?? null;
    title = (prev?.title as string | undefined) ?? null;
  }

  const { data, error } = await sb
    .from('technology_tasks')
    .update(finalPatch)
    .eq('id', id)
    .select(
      '*, technology_controls(id, title, area, status, control_key, entity_id, ops_entities(id, name))',
    )
    .single();
  if (error) throw error;
  const row = data as TechnologyTask;
  if (patch.status !== undefined && fromStatus !== patch.status) {
    logAuditCompletion({
      eventType: 'audit_task_complete',
      portal: 'technology',
      entityType: 'technology_task',
      entityId: id,
      title: title ?? row.title,
      fromStatus,
      toStatus: patch.status,
      completedAt: row.completed_at,
      extra: { control_id: row.control_id },
    });
  }
  return row;
}

/** Idempotent: create open technology_tasks for incomplete controls. */
export async function createTechnologyTasksForIncomplete(
  createdBy?: string | null,
): Promise<number> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('create_technology_tasks_for_incomplete', {
    p_created_by: createdBy ?? null,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : Number(data ?? 0);
}

/**
 * Ensure incomplete controls have technology_tasks, then push open technology_tasks
 * that lack a sales_task into portal To Do (Tage · Technology).
 */
export async function syncIncompleteTechnologyTasksToTodo(input: {
  salesUserId: string;
  syncMsTodo?: boolean;
}): Promise<{ technologyCreated: number; todoCreated: number }> {
  const technologyCreated = await createTechnologyTasksForIncomplete(input.salesUserId);
  const openTasks = await listTechnologyTasks({ status: 'open' });
  let todoCreated = 0;

  for (const task of openTasks) {
    if (task.sales_task_id) continue;
    const scope =
      task.technology_controls?.ops_entities?.name ??
      (task.technology_controls?.entity_id ? 'Entity' : 'Tage parent');
    const notes = [
      task.notes,
      `Scope: ${scope}`,
      task.technology_controls?.area ? `Area: ${task.technology_controls.area}` : '',
      task.technology_controls?.control_key
        ? `Control: ${task.technology_controls.control_key}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const { task: salesTask } = await createTask({
      sales_user_id: input.salesUserId,
      title: task.title,
      notes,
      due_at: task.due_at ? `${task.due_at}T17:00:00` : null,
      portal_slug: 'technology',
      importance: task.technology_controls?.status === 'gap' ? 'high' : 'normal',
      sync_ms_todo: input.syncMsTodo !== false,
    });

    await updateTechnologyTask(task.id, { sales_task_id: salesTask.id });
    todoCreated += 1;
  }

  return { technologyCreated, todoCreated };
}

export async function getTechnologyOverviewStats(): Promise<{
  controlCount: number;
  openCount: number;
  gapCount: number;
  overdueCount: number;
  parentCount: number;
  entityCount: number;
  openTaskCount: number;
}> {
  const [controls, tasks] = await Promise.all([
    listTechnologyControls({ entityId: 'all' }),
    listTechnologyTasks({ status: 'open' }),
  ]);
  return {
    controlCount: controls.length,
    openCount: controls.filter((c) => c.status === 'open').length,
    gapCount: controls.filter((c) => c.status === 'gap').length,
    overdueCount: controls.filter((c) => isTechnologyControlOverdue(c)).length,
    parentCount: controls.filter((c) => c.entity_id == null).length,
    entityCount: controls.filter((c) => c.entity_id != null).length,
    openTaskCount: tasks.length,
  };
}
