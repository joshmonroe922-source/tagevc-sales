import { createTask } from './api';
import { logAuditCompletion, logAuditEvent } from './audit';
import { todayDateString } from './auditControlUtils';
import { formatDate } from './types';
import { listEntities } from './opsApi';
import { requireSupabase } from './supabase';
import type {
  FinanceCloseItem,
  FinanceCloseItemStatus,
  FinanceClosePeriod,
  FinanceClosePeriodStatus,
  FinanceClosePeriodType,
  FinanceCloseTask,
  FinanceComplianceCadence,
  FinanceControl,
  FinanceControlSource,
  FinanceControlStatus,
  FinanceTask,
  FinanceTaskStatus,
} from './financeTypes';

export { formatDate };

const AUDIT_EVIDENCE_BUCKET = 'audit-evidence';

export async function listFinanceEntities() {
  return listEntities();
}

export async function listFinanceControls(opts?: {
  entityId?: string | 'parent' | 'all';
  area?: string | 'all';
  source?: FinanceControlSource | 'all';
  status?: FinanceControlStatus | 'all';
}): Promise<FinanceControl[]> {
  const sb = requireSupabase();
  let query = sb
    .from('finance_controls')
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
  return (data ?? []) as FinanceControl[];
}

export async function createFinanceControl(input: {
  title: string;
  description?: string;
  entity_id?: string | null;
  control_key?: string;
  area?: string;
  document_kind?: string;
  evidence_expectation?: string;
  source?: FinanceControlSource;
  applies_to_parent?: boolean;
  applies_to_entities?: boolean;
  cadence?: FinanceComplianceCadence;
  owner_role?: string;
  next_due_at?: string | null;
  notes?: string;
  evidence_notes?: string;
  created_by?: string | null;
}): Promise<FinanceControl> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('finance_controls')
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
      owner_role: input.owner_role?.trim() || 'Finance',
      next_due_at: input.next_due_at || null,
      notes: input.notes?.trim() ?? '',
      evidence_notes: input.evidence_notes?.trim() ?? '',
      created_by: input.created_by ?? null,
    })
    .select('*, ops_entities(id, name)')
    .single();
  if (error) throw error;
  return data as FinanceControl;
}

export async function updateFinanceControl(
  id: string,
  patch: Partial<{
    title: string;
    description: string;
    status: FinanceControlStatus;
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
    cadence: FinanceComplianceCadence;
  }>,
): Promise<FinanceControl> {
  const sb = requireSupabase();
  let fromStatus: string | null = null;
  let title: string | null = null;
  if (patch.status !== undefined) {
    const { data: prev } = await sb
      .from('finance_controls')
      .select('status, title')
      .eq('id', id)
      .maybeSingle();
    fromStatus = (prev?.status as string | undefined) ?? null;
    title = (prev?.title as string | undefined) ?? null;
  }
  const { data, error } = await sb
    .from('finance_controls')
    .update(patch)
    .eq('id', id)
    .select('*, ops_entities(id, name)')
    .single();
  if (error) throw error;
  const row = data as FinanceControl;
  if (patch.status !== undefined && fromStatus !== patch.status) {
    logAuditCompletion({
      eventType:
        patch.status === 'compliant' ? 'audit_control_reviewed' : 'audit_control_status',
      portal: 'accounting-finance',
      entityType: 'finance_control',
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
 * marks status compliant, and closes linked open finance_tasks.
 */
export async function markFinanceControlReviewed(
  id: string,
  reviewedBy?: string | null,
): Promise<FinanceControl> {
  const sb = requireSupabase();
  const { data: prev } = await sb
    .from('finance_controls')
    .select('status, title')
    .eq('id', id)
    .maybeSingle();
  const { error } = await sb.rpc('mark_finance_control_reviewed', {
    p_control_id: id,
    p_reviewed_by: reviewedBy ?? null,
  });
  if (error) throw error;
  // Re-fetch with entity join for UI
  const { data: full, error: getErr } = await sb
    .from('finance_controls')
    .select('*, ops_entities(id, name)')
    .eq('id', id)
    .single();
  if (getErr) throw getErr;
  const control = full as FinanceControl;
  logAuditCompletion({
    eventType: 'audit_control_reviewed',
    portal: 'accounting-finance',
    entityType: 'finance_control',
    entityId: id,
    title: (prev?.title as string | undefined) ?? control.title,
    fromStatus: (prev?.status as string | undefined) ?? null,
    toStatus: 'compliant',
    completedAt: control.last_reviewed_at,
  });
  return control;
}

export type UploadFinanceEvidenceResult =
  | { ok: true; control: FinanceControl }
  | { ok: false; reason: 'storage_unavailable' | 'error'; message: string };

/** Attach evidence file to a finance control (storage bucket audit-evidence). */
export async function uploadFinanceControlEvidence(input: {
  control: FinanceControl;
  file: File;
}): Promise<UploadFinanceEvidenceResult> {
  const client = requireSupabase();
  const safeName = input.file.name.replace(/[^\w.\-]+/g, '_');
  const scope = input.control.entity_id ?? 'parent';
  const path = `finance/${scope}/${input.control.id}/${Date.now()}_${safeName}`;

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
    const control = await updateFinanceControl(input.control.id, {
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

export async function getFinanceEvidenceSignedUrl(
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

export function isFinanceControlOverdue(c: FinanceControl): boolean {
  if (!c.next_due_at || c.status === 'na') return false;
  // Compliant stays overdue-capable once next_due_at arrives (reopened by task sync)
  if (c.status === 'compliant' && c.next_due_at >= new Date().toISOString().slice(0, 10)) {
    return false;
  }
  return c.next_due_at < new Date().toISOString().slice(0, 10);
}

export function isFinanceControlIncomplete(c: FinanceControl): boolean {
  return c.active && (c.status === 'open' || c.status === 'in_progress' || c.status === 'gap');
}

export async function listFinanceTasks(opts?: {
  status?: FinanceTaskStatus | 'all';
}): Promise<FinanceTask[]> {
  const sb = requireSupabase();
  let query = sb
    .from('finance_tasks')
    .select(
      '*, finance_controls(id, title, area, status, control_key, entity_id, ops_entities(id, name))',
    )
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (opts?.status && opts.status !== 'all') {
    query = query.eq('status', opts.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FinanceTask[];
}

export async function updateFinanceTask(
  id: string,
  patch: Partial<{
    status: FinanceTaskStatus;
    assigned_to: string | null;
    due_at: string | null;
    notes: string;
    sales_task_id: string | null;
    title: string;
    completed_at: string | null;
  }>,
): Promise<FinanceTask> {
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
      .from('finance_tasks')
      .select('status, title')
      .eq('id', id)
      .maybeSingle();
    fromStatus = (prev?.status as string | undefined) ?? null;
    title = (prev?.title as string | undefined) ?? null;
  }

  const { data, error } = await sb
    .from('finance_tasks')
    .update(finalPatch)
    .eq('id', id)
    .select(
      '*, finance_controls(id, title, area, status, control_key, entity_id, ops_entities(id, name))',
    )
    .single();
  if (error) throw error;
  const row = data as FinanceTask;
  if (patch.status !== undefined && fromStatus !== patch.status) {
    logAuditCompletion({
      eventType: 'audit_task_complete',
      portal: 'accounting-finance',
      entityType: 'finance_task',
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

/** Idempotent: create open finance_tasks for incomplete controls. */
export async function createFinanceTasksForIncomplete(
  createdBy?: string | null,
): Promise<number> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('create_finance_tasks_for_incomplete', {
    p_created_by: createdBy ?? null,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : Number(data ?? 0);
}

/**
 * Ensure incomplete controls have finance_tasks, then push open finance_tasks
 * that lack a sales_task into portal To Do (Tage · Accounting and Finance).
 */
export async function syncIncompleteFinanceTasksToTodo(input: {
  salesUserId: string;
  syncMsTodo?: boolean;
}): Promise<{ financeCreated: number; todoCreated: number }> {
  const financeCreated = await createFinanceTasksForIncomplete(input.salesUserId);
  const openTasks = await listFinanceTasks({ status: 'open' });
  let todoCreated = 0;

  for (const task of openTasks) {
    if (task.sales_task_id) continue;
    const scope =
      task.finance_controls?.ops_entities?.name ??
      (task.finance_controls?.entity_id ? 'Entity' : 'Tage parent');
    const notes = [
      task.notes,
      `Scope: ${scope}`,
      task.finance_controls?.area ? `Area: ${task.finance_controls.area}` : '',
      task.finance_controls?.control_key
        ? `Control: ${task.finance_controls.control_key}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const { task: salesTask } = await createTask({
      sales_user_id: input.salesUserId,
      title: task.title,
      notes,
      due_at: task.due_at ? `${task.due_at}T17:00:00` : null,
      portal_slug: 'accounting-finance',
      importance: task.finance_controls?.status === 'gap' ? 'high' : 'normal',
      sync_ms_todo: input.syncMsTodo !== false,
    });

    await updateFinanceTask(task.id, { sales_task_id: salesTask.id });
    todoCreated += 1;
  }

  return { financeCreated, todoCreated };
}

export async function getFinanceOverviewStats(): Promise<{
  controlCount: number;
  openCount: number;
  gapCount: number;
  overdueCount: number;
  parentCount: number;
  entityCount: number;
  openTaskCount: number;
  openMonthCloseCount: number;
  openYearCloseCount: number;
}> {
  const [controls, tasks, monthPeriods, yearPeriods] = await Promise.all([
    listFinanceControls({ entityId: 'all' }),
    listFinanceTasks({ status: 'open' }),
    listFinanceClosePeriods({ periodType: 'month' }).catch(() => [] as FinanceClosePeriod[]),
    listFinanceClosePeriods({ periodType: 'year' }).catch(() => [] as FinanceClosePeriod[]),
  ]);
  const openish = (p: FinanceClosePeriod) =>
    p.status === 'open' || p.status === 'in_progress';
  return {
    controlCount: controls.length,
    openCount: controls.filter((c) => c.status === 'open').length,
    gapCount: controls.filter((c) => c.status === 'gap').length,
    overdueCount: controls.filter((c) => isFinanceControlOverdue(c)).length,
    parentCount: controls.filter((c) => c.entity_id == null).length,
    entityCount: controls.filter((c) => c.entity_id != null).length,
    openTaskCount: tasks.length,
    openMonthCloseCount: monthPeriods.filter(openish).length,
    openYearCloseCount: yearPeriods.filter(openish).length,
  };
}

// ---------------------------------------------------------------------------
// Month-end / year-end close
// ---------------------------------------------------------------------------

export function currentFinanceClosePeriodKey(periodType: FinanceClosePeriodType): string {
  const now = new Date();
  const y = now.getFullYear();
  if (periodType === 'year') return String(y);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function formatFinanceClosePeriodKey(
  periodType: FinanceClosePeriodType,
  periodKey: string,
): string {
  if (periodType === 'year') return periodKey;
  const [y, m] = periodKey.split('-');
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const mi = Number(m) - 1;
  if (!y || Number.isNaN(mi) || mi < 0 || mi > 11) return periodKey;
  return `${monthNames[mi]} ${y}`;
}

export async function listFinanceClosePeriods(opts?: {
  periodType?: FinanceClosePeriodType;
  periodKey?: string;
  entityId?: string | 'parent' | 'all';
  status?: FinanceClosePeriodStatus | 'all';
}): Promise<FinanceClosePeriod[]> {
  const sb = requireSupabase();
  let query = sb
    .from('finance_close_periods')
    .select('*, ops_entities(id, name)')
    .order('period_key', { ascending: false });

  if (opts?.periodType) query = query.eq('period_type', opts.periodType);
  if (opts?.periodKey) query = query.eq('period_key', opts.periodKey);
  if (opts?.entityId === 'parent') {
    query = query.is('entity_id', null);
  } else if (opts?.entityId && opts.entityId !== 'all') {
    query = query.eq('entity_id', opts.entityId);
  }
  if (opts?.status && opts.status !== 'all') {
    query = query.eq('status', opts.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FinanceClosePeriod[];
}

export async function listFinanceCloseItems(periodId: string): Promise<FinanceCloseItem[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('finance_close_items')
    .select('*')
    .eq('period_id', periodId)
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true });
  if (error) throw error;
  return (data ?? []) as FinanceCloseItem[];
}

/** Create or reopen a period and seed checklist items from templates. */
export async function openFinanceClosePeriod(input: {
  entityId: string | null;
  periodType: FinanceClosePeriodType;
  periodKey: string;
}): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('open_finance_close_period', {
    p_entity_id: input.entityId,
    p_period_type: input.periodType,
    p_period_key: input.periodKey,
  });
  if (error) throw error;
  return String(data);
}

export async function completeFinanceClosePeriod(
  periodId: string,
  closedBy?: string | null,
): Promise<string> {
  const sb = requireSupabase();
  const { data: prev } = await sb
    .from('finance_close_periods')
    .select('status, period_key, period_type, entity_id')
    .eq('id', periodId)
    .maybeSingle();
  const { data, error } = await sb.rpc('complete_finance_close_period', {
    p_period_id: periodId,
    p_closed_by: closedBy ?? null,
  });
  if (error) throw error;
  logAuditCompletion({
    eventType: 'finance_close_period_complete',
    portal: 'accounting-finance',
    entityType: 'finance_close_period',
    entityId: periodId,
    title: prev?.period_key ? String(prev.period_key) : periodId,
    fromStatus: (prev?.status as string | undefined) ?? null,
    toStatus: 'closed',
    completedAt: new Date().toISOString(),
    extra: {
      period_type: prev?.period_type ?? null,
      entity_id: prev?.entity_id ?? null,
      next_period_id: data != null ? String(data) : null,
    },
  });
  return String(data);
}

export async function ensureFinanceClosePeriodsForYear(year?: number): Promise<number> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('ensure_finance_close_periods_for_year', {
    p_year: year ?? new Date().getFullYear(),
  });
  if (error) throw error;
  return typeof data === 'number' ? data : Number(data ?? 0);
}

export async function updateFinanceCloseItem(
  id: string,
  patch: Partial<{
    status: FinanceCloseItemStatus;
    owner_role: string;
    due_at: string | null;
    completed_at: string | null;
    evidence_url: string;
    evidence_notes: string;
    evidence_storage_path: string;
    evidence_file_name: string;
    evidence_mime_type: string;
    notes: string;
  }>,
): Promise<FinanceCloseItem> {
  const sb = requireSupabase();
  const finalPatch: typeof patch = { ...patch };
  if (patch.status === 'done' && finalPatch.completed_at === undefined) {
    finalPatch.completed_at = todayDateString();
  } else if (
    patch.status &&
    patch.status !== 'done' &&
    patch.status !== 'na' &&
    finalPatch.completed_at === undefined
  ) {
    finalPatch.completed_at = null;
  }

  let fromStatus: string | null = null;
  let title: string | null = null;
  if (patch.status !== undefined) {
    const { data: prev } = await sb
      .from('finance_close_items')
      .select('status, title')
      .eq('id', id)
      .maybeSingle();
    fromStatus = (prev?.status as string | undefined) ?? null;
    title = (prev?.title as string | undefined) ?? null;
  }

  const { data, error } = await sb
    .from('finance_close_items')
    .update(finalPatch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  const row = data as FinanceCloseItem;
  if (patch.status !== undefined && fromStatus !== patch.status) {
    logAuditCompletion({
      eventType:
        patch.status === 'done'
          ? 'finance_close_item_complete'
          : 'audit_control_status',
      portal: 'accounting-finance',
      entityType: 'finance_close_item',
      entityId: id,
      title: title ?? row.title,
      fromStatus,
      toStatus: patch.status,
      completedAt: row.completed_at,
      extra: { period_id: row.period_id },
    });
  }
  return row;
}

export async function markFinanceCloseItemDone(
  id: string,
  completedBy?: string | null,
): Promise<FinanceCloseItem> {
  const sb = requireSupabase();
  const { data: prev } = await sb
    .from('finance_close_items')
    .select('status, title, period_id')
    .eq('id', id)
    .maybeSingle();
  const { error } = await sb.rpc('mark_finance_close_item_done', {
    p_item_id: id,
    p_completed_by: completedBy ?? null,
  });
  if (error) throw error;
  const { data, error: getErr } = await sb
    .from('finance_close_items')
    .select('*')
    .eq('id', id)
    .single();
  if (getErr) throw getErr;
  const item = data as FinanceCloseItem;
  logAuditCompletion({
    eventType: 'finance_close_item_complete',
    portal: 'accounting-finance',
    entityType: 'finance_close_item',
    entityId: id,
    title: (prev?.title as string | undefined) ?? item.title,
    fromStatus: (prev?.status as string | undefined) ?? null,
    toStatus: 'done',
    completedAt: item.completed_at,
    extra: { period_id: item.period_id },
  });
  return item;
}

export type UploadFinanceCloseEvidenceResult =
  | { ok: true; item: FinanceCloseItem }
  | { ok: false; reason: 'storage_unavailable' | 'error'; message: string };

export async function uploadFinanceCloseItemEvidence(input: {
  item: FinanceCloseItem;
  period: FinanceClosePeriod;
  file: File;
}): Promise<UploadFinanceCloseEvidenceResult> {
  const client = requireSupabase();
  const safeName = input.file.name.replace(/[^\w.\-]+/g, '_');
  const scope = input.period.entity_id ?? 'parent';
  const path = `finance-close/${scope}/${input.period.period_key}/${input.item.id}/${Date.now()}_${safeName}`;

  const { error: upErr } = await client.storage.from(AUDIT_EVIDENCE_BUCKET).upload(path, input.file, {
    contentType: input.file.type || 'application/octet-stream',
    upsert: false,
  });

  if (upErr) {
    const msg = upErr.message || String(upErr);
    const unavailable = /bucket|not found|does not exist|row-level security|403|404/i.test(msg);
    return {
      ok: false,
      reason: unavailable ? 'storage_unavailable' : 'error',
      message: msg,
    };
  }

  try {
    const item = await updateFinanceCloseItem(input.item.id, {
      evidence_storage_path: path,
      evidence_file_name: input.file.name,
      evidence_mime_type: input.file.type || '',
    });
    return { ok: true, item };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function createFinanceCloseTasksForIncomplete(
  createdBy?: string | null,
  periodId?: string | null,
): Promise<number> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('create_finance_close_tasks_for_incomplete', {
    p_created_by: createdBy ?? null,
    p_period_id: periodId ?? null,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : Number(data ?? 0);
}

export async function listFinanceCloseTasks(opts?: {
  status?: FinanceTaskStatus | 'all';
}): Promise<FinanceCloseTask[]> {
  const sb = requireSupabase();
  let query = sb
    .from('finance_close_tasks')
    .select(
      '*, finance_close_items(id, title, area, status, item_key, period_id, finance_close_periods(id, period_type, period_key, entity_id, ops_entities(id, name)))',
    )
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (opts?.status && opts.status !== 'all') {
    query = query.eq('status', opts.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FinanceCloseTask[];
}

export async function updateFinanceCloseTask(
  id: string,
  patch: Partial<{
    status: FinanceTaskStatus;
    assigned_to: string | null;
    due_at: string | null;
    notes: string;
    sales_task_id: string | null;
    title: string;
    completed_at: string | null;
  }>,
): Promise<FinanceCloseTask> {
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
      .from('finance_close_tasks')
      .select('status, title')
      .eq('id', id)
      .maybeSingle();
    fromStatus = (prev?.status as string | undefined) ?? null;
    title = (prev?.title as string | undefined) ?? null;
  }

  const { data, error } = await sb
    .from('finance_close_tasks')
    .update(finalPatch)
    .eq('id', id)
    .select(
      '*, finance_close_items(id, title, area, status, item_key, period_id, finance_close_periods(id, period_type, period_key, entity_id, ops_entities(id, name)))',
    )
    .single();
  if (error) throw error;
  const row = data as FinanceCloseTask;
  if (patch.status !== undefined && fromStatus !== patch.status) {
    logAuditCompletion({
      eventType: 'audit_task_complete',
      portal: 'accounting-finance',
      entityType: 'finance_close_task',
      entityId: id,
      title: title ?? row.title,
      fromStatus,
      toStatus: patch.status,
      completedAt: row.completed_at,
      extra: { item_id: row.item_id },
    });
  }
  return row;
}

/**
 * Ensure incomplete close items have finance_close_tasks, then push those
 * lacking a sales_task into portal To Do.
 */
export async function syncIncompleteFinanceCloseTasksToTodo(input: {
  salesUserId: string;
  periodId?: string | null;
  syncMsTodo?: boolean;
}): Promise<{ closeCreated: number; todoCreated: number }> {
  const closeCreated = await createFinanceCloseTasksForIncomplete(
    input.salesUserId,
    input.periodId ?? null,
  );
  const openTasks = await listFinanceCloseTasks({ status: 'open' });
  let todoCreated = 0;

  for (const task of openTasks) {
    if (task.sales_task_id) continue;
    if (input.periodId && task.finance_close_items?.period_id !== input.periodId) continue;
    const period = task.finance_close_items?.finance_close_periods;
    const scope =
      period?.ops_entities?.name ?? (period?.entity_id ? 'Entity' : 'Tage parent');
    const notes = [
      task.notes,
      `Scope: ${scope}`,
      period ? `Period: ${period.period_key} (${period.period_type})` : '',
      task.finance_close_items?.area ? `Area: ${task.finance_close_items.area}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const { task: salesTask } = await createTask({
      sales_user_id: input.salesUserId,
      title: task.title,
      notes,
      due_at: task.due_at ? `${task.due_at}T17:00:00` : null,
      portal_slug: 'accounting-finance',
      importance: task.finance_close_items?.status === 'blocked' ? 'high' : 'normal',
      sync_ms_todo: input.syncMsTodo !== false,
    });

    await updateFinanceCloseTask(task.id, { sales_task_id: salesTask.id });
    todoCreated += 1;
  }

  return { closeCreated, todoCreated };
}

export function isFinanceCloseItemIncomplete(i: FinanceCloseItem): boolean {
  return i.status === 'open' || i.status === 'in_progress' || i.status === 'blocked';
}
