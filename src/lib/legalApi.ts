import { createTask } from './api';
import { logAuditCompletion, logAuditEvent } from './audit';
import {
  AUDIT_EVIDENCE_BUCKET,
  buildAuditEvidencePath,
  isAuditControlDueSoon,
  isAuditControlOverdue,
  todayDateString,
} from './auditControlUtils';
import { formatDate } from './types';
import { listEntities } from './opsApi';
import { requireSupabase } from './supabase';
import type {
  LegalComplianceCadence,
  LegalControl,
  LegalControlSource,
  LegalControlStatus,
  LegalTask,
  LegalTaskStatus,
} from './legalTypes';

export { formatDate };
export { buildMarkReviewedPatch, isAuditControlDueSoon } from './auditControlUtils';

export async function listLegalEntities() {
  return listEntities();
}

export async function listLegalControls(opts?: {
  entityId?: string | 'parent' | 'all';
  area?: string | 'all';
  source?: LegalControlSource | 'all';
  status?: LegalControlStatus | 'all';
}): Promise<LegalControl[]> {
  const sb = requireSupabase();
  let query = sb
    .from('legal_controls')
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
  return (data ?? []) as LegalControl[];
}

export async function createLegalControl(input: {
  title: string;
  description?: string;
  entity_id?: string | null;
  control_key?: string;
  area?: string;
  document_kind?: string;
  evidence_expectation?: string;
  source?: LegalControlSource;
  applies_to_parent?: boolean;
  applies_to_entities?: boolean;
  cadence?: LegalComplianceCadence;
  owner_role?: string;
  next_due_at?: string | null;
  notes?: string;
  evidence_notes?: string;
  created_by?: string | null;
}): Promise<LegalControl> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('legal_controls')
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
      owner_role: input.owner_role?.trim() || 'Legal',
      next_due_at: input.next_due_at || null,
      notes: input.notes?.trim() ?? '',
      evidence_notes: input.evidence_notes?.trim() ?? '',
      created_by: input.created_by ?? null,
    })
    .select('*, ops_entities(id, name)')
    .single();
  if (error) throw error;
  return data as LegalControl;
}

export async function updateLegalControl(
  id: string,
  patch: Partial<{
    title: string;
    description: string;
    status: LegalControlStatus;
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
    cadence: LegalComplianceCadence;
  }>,
): Promise<LegalControl> {
  const sb = requireSupabase();
  let fromStatus: string | null = null;
  let title: string | null = null;
  if (patch.status !== undefined) {
    const { data: prev } = await sb
      .from('legal_controls')
      .select('status, title')
      .eq('id', id)
      .maybeSingle();
    fromStatus = (prev?.status as string | undefined) ?? null;
    title = (prev?.title as string | undefined) ?? null;
  }
  const { data, error } = await sb
    .from('legal_controls')
    .update(patch)
    .eq('id', id)
    .select('*, ops_entities(id, name)')
    .single();
  if (error) throw error;
  const row = data as LegalControl;
  if (patch.status !== undefined && fromStatus !== patch.status) {
    logAuditCompletion({
      eventType:
        patch.status === 'compliant' ? 'audit_control_reviewed' : 'audit_control_status',
      portal: 'legal',
      entityType: 'legal_control',
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

export async function markLegalControlReviewed(
  id: string,
  reviewedBy?: string | null,
): Promise<LegalControl> {
  const sb = requireSupabase();
  const { data: prev } = await sb
    .from('legal_controls')
    .select('status, title')
    .eq('id', id)
    .maybeSingle();
  const { data, error } = await sb.rpc('mark_legal_control_reviewed', {
    p_control_id: id,
    p_reviewed_by: reviewedBy ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('mark_legal_control_reviewed returned no row');
  const { data: full, error: getErr } = await sb
    .from('legal_controls')
    .select('*, ops_entities(id, name)')
    .eq('id', id)
    .single();
  if (getErr) throw getErr;
  const control = full as LegalControl;
  logAuditCompletion({
    eventType: 'audit_control_reviewed',
    portal: 'legal',
    entityType: 'legal_control',
    entityId: id,
    title: (prev?.title as string | undefined) ?? control.title,
    fromStatus: (prev?.status as string | undefined) ?? null,
    toStatus: 'compliant',
    completedAt: control.last_reviewed_at,
  });
  return control;
}

export type UploadLegalEvidenceResult =
  | { ok: true; control: LegalControl }
  | { ok: false; reason: 'storage_unavailable' | 'error'; message: string };

export async function uploadLegalControlEvidence(input: {
  control: LegalControl;
  file: File;
}): Promise<UploadLegalEvidenceResult> {
  const client = requireSupabase();
  const path = buildAuditEvidencePath('legal', input.control.id, input.file.name);

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
    const control = await updateLegalControl(input.control.id, {
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

export async function getLegalEvidenceSignedUrl(
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
        kind: 'legal_evidence',
      },
    });
  }
  return data.signedUrl ?? null;
}

export function isLegalControlOverdue(c: LegalControl): boolean {
  return isAuditControlOverdue(c);
}

export function isLegalControlDueSoonLocal(c: LegalControl): boolean {
  return isAuditControlDueSoon(c);
}

export function isLegalControlIncomplete(c: LegalControl): boolean {
  return c.active && (c.status === 'open' || c.status === 'in_progress' || c.status === 'gap');
}

export async function listLegalTasks(opts?: {
  status?: LegalTaskStatus | 'all';
}): Promise<LegalTask[]> {
  const sb = requireSupabase();
  let query = sb
    .from('legal_tasks')
    .select(
      '*, legal_controls(id, title, area, status, control_key, entity_id, ops_entities(id, name))',
    )
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (opts?.status && opts.status !== 'all') {
    query = query.eq('status', opts.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as LegalTask[];
}

export async function updateLegalTask(
  id: string,
  patch: Partial<{
    status: LegalTaskStatus;
    assigned_to: string | null;
    due_at: string | null;
    notes: string;
    sales_task_id: string | null;
    title: string;
    completed_at: string | null;
  }>,
): Promise<LegalTask> {
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
      .from('legal_tasks')
      .select('status, title')
      .eq('id', id)
      .maybeSingle();
    fromStatus = (prev?.status as string | undefined) ?? null;
    title = (prev?.title as string | undefined) ?? null;
  }

  const { data, error } = await sb
    .from('legal_tasks')
    .update(finalPatch)
    .eq('id', id)
    .select(
      '*, legal_controls(id, title, area, status, control_key, entity_id, ops_entities(id, name))',
    )
    .single();
  if (error) throw error;
  const row = data as LegalTask;
  if (patch.status !== undefined && fromStatus !== patch.status) {
    logAuditCompletion({
      eventType: 'audit_task_complete',
      portal: 'legal',
      entityType: 'legal_task',
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

/** Idempotent: create open legal_tasks for incomplete controls. */
export async function createLegalTasksForIncomplete(
  createdBy?: string | null,
): Promise<number> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('create_legal_tasks_for_incomplete', {
    p_created_by: createdBy ?? null,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : Number(data ?? 0);
}

/**
 * Ensure incomplete controls have legal_tasks, then push open legal_tasks
 * that lack a sales_task into portal To Do (Tage · Legal) via createTask.
 */
export async function syncIncompleteLegalTasksToTodo(input: {
  salesUserId: string;
  syncMsTodo?: boolean;
}): Promise<{ legalCreated: number; todoCreated: number }> {
  const legalCreated = await createLegalTasksForIncomplete(input.salesUserId);
  const openTasks = await listLegalTasks({ status: 'open' });
  let todoCreated = 0;

  for (const task of openTasks) {
    if (task.sales_task_id) continue;
    const scope =
      task.legal_controls?.ops_entities?.name ??
      (task.legal_controls?.entity_id ? 'Entity' : 'Tage parent');
    const notes = [
      task.notes,
      `Scope: ${scope}`,
      task.legal_controls?.area ? `Area: ${task.legal_controls.area}` : '',
      task.legal_controls?.control_key
        ? `Control: ${task.legal_controls.control_key}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const { task: salesTask } = await createTask({
      sales_user_id: input.salesUserId,
      title: task.title,
      notes,
      due_at: task.due_at ? `${task.due_at}T17:00:00` : null,
      portal_slug: 'legal',
      importance: task.legal_controls?.status === 'gap' ? 'high' : 'normal',
      sync_ms_todo: input.syncMsTodo !== false,
    });

    await updateLegalTask(task.id, { sales_task_id: salesTask.id });
    todoCreated += 1;
  }

  return { legalCreated, todoCreated };
}

export async function getLegalOverviewStats(): Promise<{
  controlCount: number;
  openCount: number;
  gapCount: number;
  overdueCount: number;
  parentCount: number;
  entityCount: number;
  openTaskCount: number;
}> {
  const [controls, tasks] = await Promise.all([
    listLegalControls({ entityId: 'all' }),
    listLegalTasks({ status: 'open' }),
  ]);
  return {
    controlCount: controls.length,
    openCount: controls.filter((c) => c.status === 'open').length,
    gapCount: controls.filter((c) => c.status === 'gap').length,
    overdueCount: controls.filter((c) => isLegalControlOverdue(c)).length,
    parentCount: controls.filter((c) => c.entity_id == null).length,
    entityCount: controls.filter((c) => c.entity_id != null).length,
    openTaskCount: tasks.length,
  };
}
