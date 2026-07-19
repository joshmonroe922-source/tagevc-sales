import { createTask } from './api';
import { logAuditCompletion, logAuditEvent } from './audit';
import {
  AUDIT_EVIDENCE_BUCKET,
  buildAuditEvidencePath,
  initialDueDateFromFrequency,
  todayDateString,
} from './auditControlUtils';
import { formatDate } from './types';
import { listEntities } from './opsApi';
import { requireSupabase } from './supabase';
import type {
  MarketingComplianceCadence,
  MarketingControl,
  MarketingControlSource,
  MarketingControlStatus,
  MarketingTask,
  MarketingTaskStatus,
} from './marketingTypes';

export { formatDate };

export async function listMarketingEntities() {
  return listEntities();
}

export async function listMarketingControls(opts?: {
  entityId?: string | 'parent' | 'all';
  area?: string | 'all';
  source?: MarketingControlSource | 'all';
  status?: MarketingControlStatus | 'all';
}): Promise<MarketingControl[]> {
  const sb = requireSupabase();
  let query = sb
    .from('marketing_controls')
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
  return (data ?? []) as MarketingControl[];
}

export async function createMarketingControl(input: {
  title: string;
  description?: string;
  entity_id?: string | null;
  control_key?: string;
  area?: string;
  document_kind?: string;
  evidence_expectation?: string;
  source?: MarketingControlSource;
  applies_to_parent?: boolean;
  applies_to_entities?: boolean;
  cadence?: MarketingComplianceCadence;
  owner_role?: string;
  next_due_at?: string | null;
  notes?: string;
  evidence_notes?: string;
  created_by?: string | null;
}): Promise<MarketingControl> {
  const sb = requireSupabase();
  const cadence = input.cadence ?? 'annual';
  const nextDue = input.next_due_at || initialDueDateFromFrequency(cadence);
  const { data, error } = await sb
    .from('marketing_controls')
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
      cadence,
      owner_role: input.owner_role?.trim() || 'Marketing',
      next_due_at: nextDue,
      notes: input.notes?.trim() ?? '',
      evidence_notes: input.evidence_notes?.trim() ?? '',
      created_by: input.created_by ?? null,
    })
    .select('*, ops_entities(id, name)')
    .single();
  if (error) throw error;
  return data as MarketingControl;
}

export async function updateMarketingControl(
  id: string,
  patch: Partial<{
    title: string;
    description: string;
    status: MarketingControlStatus;
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
    cadence: MarketingComplianceCadence;
  }>,
): Promise<MarketingControl> {
  const sb = requireSupabase();
  let fromStatus: string | null = null;
  let title: string | null = null;
  if (patch.status !== undefined) {
    const { data: prev } = await sb
      .from('marketing_controls')
      .select('status, title')
      .eq('id', id)
      .maybeSingle();
    fromStatus = (prev?.status as string | undefined) ?? null;
    title = (prev?.title as string | undefined) ?? null;
  }
  const { data, error } = await sb
    .from('marketing_controls')
    .update(patch)
    .eq('id', id)
    .select('*, ops_entities(id, name)')
    .single();
  if (error) throw error;
  const row = data as MarketingControl;
  if (patch.status !== undefined && fromStatus !== patch.status) {
    logAuditCompletion({
      eventType:
        patch.status === 'compliant' ? 'audit_control_reviewed' : 'audit_control_status',
      portal: 'marketing',
      entityType: 'marketing_control',
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
 * Mark reviewed: rolls next_due_at by cadence (review frequency),
 * sets status compliant, closes linked open marketing_tasks.
 */
export async function markMarketingControlReviewed(
  id: string,
  reviewedBy?: string | null,
): Promise<MarketingControl> {
  const sb = requireSupabase();
  const { data: prev } = await sb
    .from('marketing_controls')
    .select('status, title')
    .eq('id', id)
    .maybeSingle();
  const { error } = await sb.rpc('mark_marketing_control_reviewed', {
    p_control_id: id,
    p_reviewed_by: reviewedBy ?? null,
  });
  if (error) throw error;
  const { data: full, error: getErr } = await sb
    .from('marketing_controls')
    .select('*, ops_entities(id, name)')
    .eq('id', id)
    .single();
  if (getErr) throw getErr;
  const control = full as MarketingControl;
  logAuditCompletion({
    eventType: 'audit_control_reviewed',
    portal: 'marketing',
    entityType: 'marketing_control',
    entityId: id,
    title: (prev?.title as string | undefined) ?? control.title,
    fromStatus: (prev?.status as string | undefined) ?? null,
    toStatus: 'compliant',
    completedAt: control.last_reviewed_at,
  });
  return control;
}

export type MarketingEvidenceUploadResult =
  | { ok: true; control: MarketingControl }
  | { ok: false; reason: 'storage_unavailable' | 'error'; message: string };

export async function uploadMarketingControlEvidence(input: {
  control: MarketingControl;
  file: File;
}): Promise<MarketingEvidenceUploadResult> {
  const sb = requireSupabase();
  const path = buildAuditEvidencePath('marketing', input.control.id, input.file.name);
  const { error: upErr } = await sb.storage.from(AUDIT_EVIDENCE_BUCKET).upload(path, input.file, {
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
    const control = await updateMarketingControl(input.control.id, {
      evidence_storage_path: path,
      evidence_file_name: input.file.name,
      evidence_mime_type: input.file.type || '',
    });
    return { ok: true, control };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'Failed to save evidence path',
    };
  }
}

export async function getMarketingEvidenceSignedUrl(
  storagePath: string,
  expiresIn = 3600,
): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await requireSupabase()
    .storage.from(AUDIT_EVIDENCE_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error || !data?.signedUrl) return null;
  void logAuditEvent({
    eventType: 'download',
    metadata: {
      destination_url: data.signedUrl.split('?')[0],
      storage_path: storagePath,
      kind: 'signed_url',
      bucket: AUDIT_EVIDENCE_BUCKET,
    },
  });
  return data.signedUrl;
}

export function isMarketingControlOverdue(c: MarketingControl): boolean {
  if (!c.next_due_at || c.status === 'compliant' || c.status === 'na') return false;
  return c.next_due_at < new Date().toISOString().slice(0, 10);
}

export function isMarketingControlIncomplete(c: MarketingControl): boolean {
  return c.active && (c.status === 'open' || c.status === 'in_progress' || c.status === 'gap');
}

export async function listMarketingTasks(opts?: {
  status?: MarketingTaskStatus | 'all';
}): Promise<MarketingTask[]> {
  const sb = requireSupabase();
  let query = sb
    .from('marketing_tasks')
    .select(
      '*, marketing_controls(id, title, area, status, control_key, entity_id, ops_entities(id, name))',
    )
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (opts?.status && opts.status !== 'all') {
    query = query.eq('status', opts.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as MarketingTask[];
}

export async function updateMarketingTask(
  id: string,
  patch: Partial<{
    status: MarketingTaskStatus;
    assigned_to: string | null;
    due_at: string | null;
    notes: string;
    sales_task_id: string | null;
    title: string;
    completed_at: string | null;
  }>,
): Promise<MarketingTask> {
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
      .from('marketing_tasks')
      .select('status, title')
      .eq('id', id)
      .maybeSingle();
    fromStatus = (prev?.status as string | undefined) ?? null;
    title = (prev?.title as string | undefined) ?? null;
  }

  const { data, error } = await sb
    .from('marketing_tasks')
    .update(finalPatch)
    .eq('id', id)
    .select(
      '*, marketing_controls(id, title, area, status, control_key, entity_id, ops_entities(id, name))',
    )
    .single();
  if (error) throw error;
  const row = data as MarketingTask;
  if (patch.status !== undefined && fromStatus !== patch.status) {
    logAuditCompletion({
      eventType: 'audit_task_complete',
      portal: 'marketing',
      entityType: 'marketing_task',
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

export async function createMarketingTasksForIncomplete(
  createdBy?: string | null,
): Promise<number> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('create_marketing_tasks_for_incomplete', {
    p_created_by: createdBy ?? null,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : Number(data ?? 0);
}

export async function syncIncompleteMarketingTasksToTodo(input: {
  salesUserId: string;
  syncMsTodo?: boolean;
}): Promise<{ marketingCreated: number; todoCreated: number }> {
  const marketingCreated = await createMarketingTasksForIncomplete(input.salesUserId);
  const openTasks = await listMarketingTasks({ status: 'open' });
  let todoCreated = 0;

  for (const task of openTasks) {
    if (task.sales_task_id) continue;
    const scope =
      task.marketing_controls?.ops_entities?.name ??
      (task.marketing_controls?.entity_id ? 'Entity' : 'Tage parent');
    const notes = [
      task.notes,
      `Scope: ${scope}`,
      task.marketing_controls?.area ? `Area: ${task.marketing_controls.area}` : '',
      task.marketing_controls?.control_key
        ? `Control: ${task.marketing_controls.control_key}`
        : '',
      task.due_at ? `Due: ${task.due_at}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const { task: salesTask } = await createTask({
      sales_user_id: input.salesUserId,
      title: task.title,
      notes,
      due_at: task.due_at ? `${task.due_at}T17:00:00` : null,
      portal_slug: 'marketing',
      importance:
        task.marketing_controls?.status === 'gap' ||
        (task.due_at != null && task.due_at < new Date().toISOString().slice(0, 10))
          ? 'high'
          : 'normal',
      sync_ms_todo: input.syncMsTodo !== false,
    });

    await updateMarketingTask(task.id, { sales_task_id: salesTask.id });
    todoCreated += 1;
  }

  return { marketingCreated, todoCreated };
}

export async function getMarketingOverviewStats(): Promise<{
  controlCount: number;
  openCount: number;
  gapCount: number;
  overdueCount: number;
  parentCount: number;
  entityCount: number;
  openTaskCount: number;
}> {
  const [controls, tasks] = await Promise.all([
    listMarketingControls({ entityId: 'all' }),
    listMarketingTasks({ status: 'open' }),
  ]);
  return {
    controlCount: controls.length,
    openCount: controls.filter((c) => c.status === 'open').length,
    gapCount: controls.filter((c) => c.status === 'gap').length,
    overdueCount: controls.filter((c) => isMarketingControlOverdue(c)).length,
    parentCount: controls.filter((c) => c.entity_id == null).length,
    entityCount: controls.filter((c) => c.entity_id != null).length,
    openTaskCount: tasks.length,
  };
}
