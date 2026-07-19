import { formatDate } from './types';
import { listEntities } from './opsApi';
import { requireSupabase } from './supabase';
import { logAuditCompletion } from './audit';
import {
  AUDIT_EVIDENCE_BUCKET,
  buildAuditEvidencePath,
  buildMarkReviewedPatch,
  isAuditControlOverdue,
  todayDateString,
} from './auditControlUtils';
import type {
  HrActivityType,
  HrChecklistItem,
  HrChecklistKind,
  HrChecklistTemplateItem,
  HrComplianceCadence,
  HrComplianceControl,
  HrControlSource,
  HrControlStatus,
  HrDocCategory,
  HrDocKind,
  HrEmployee,
  HrEmployeeActivity,
  HrEmployeeDocument,
  HrEmploymentStatus,
  HrItemScope,
  HrItemStatus,
  HrOnboardingChecklist,
  HrSystemHook,
  HrTemplateItemSeed,
} from './hrTypes';
import {
  DEFAULT_OFFBOARDING_ITEMS,
  DEFAULT_ONBOARDING_ITEMS,
  DEFAULT_TALENT_ACQUISITION_ITEMS,
  HR_TEMPLATE_SLUGS,
} from './hrTypes';

export { formatDate };

export async function listHrEntities() {
  return listEntities();
}

export async function listEmployees(opts?: {
  status?: HrEmploymentStatus | 'all';
  q?: string;
}): Promise<HrEmployee[]> {
  const sb = requireSupabase();
  let query = sb
    .from('hr_employees')
    .select('*, ops_entities(id, name)')
    .order('full_name', { ascending: true });

  if (opts?.status && opts.status !== 'all') {
    query = query.eq('employment_status', opts.status);
  }
  if (opts?.q?.trim()) {
    const q = opts.q.trim();
    query = query.or(
      `full_name.ilike.%${q}%,work_email.ilike.%${q}%,role_title.ilike.%${q}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as HrEmployee[];
}

export async function getEmployee(id: string): Promise<HrEmployee> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('hr_employees')
    .select('*, ops_entities(id, name)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as HrEmployee;
}

export async function createEmployee(input: {
  full_name: string;
  work_email?: string;
  personal_email?: string;
  role_title?: string;
  department?: string;
  employment_status?: HrEmploymentStatus;
  entity_id?: string | null;
  start_date?: string | null;
  manager_name?: string;
  location?: string;
  notes?: string;
  created_by?: string | null;
  /** When true (default for prospect), start the talent acquisition checklist. */
  start_talent_checklist?: boolean;
}): Promise<HrEmployee> {
  const sb = requireSupabase();
  const employmentStatus = input.employment_status ?? 'prospect';
  const { data, error } = await sb
    .from('hr_employees')
    .insert({
      full_name: input.full_name.trim(),
      work_email: input.work_email?.trim() ?? '',
      personal_email: input.personal_email?.trim() ?? '',
      role_title: input.role_title?.trim() ?? '',
      department: input.department?.trim() ?? '',
      employment_status: employmentStatus,
      entity_id: input.entity_id || null,
      start_date: input.start_date || null,
      manager_name: input.manager_name?.trim() ?? '',
      location: input.location?.trim() ?? '',
      notes: input.notes?.trim() ?? '',
      created_by: input.created_by ?? null,
    })
    .select('*, ops_entities(id, name)')
    .single();
  if (error) throw error;

  const emp = data as HrEmployee;
  try {
    await createEmployeeActivity({
      employee_id: emp.id,
      activity_type: 'status_change',
      title: 'Employee file opened',
      body: `Status: ${emp.employment_status}`,
      status: emp.employment_status,
      created_by: input.created_by ?? null,
    });
  } catch {
    /* activities table may lag if migration pending */
  }

  const shouldStartTa =
    input.start_talent_checklist !== false && employmentStatus === 'prospect';
  if (shouldStartTa) {
    try {
      await startChecklist({
        employee_id: emp.id,
        kind: 'talent_acquisition',
        created_by: input.created_by ?? null,
        update_employee_status: false,
      });
    } catch {
      /* templates may lag if migration pending — file still created */
    }
  }

  return emp;
}

export async function updateEmployee(
  id: string,
  patch: Partial<{
    full_name: string;
    work_email: string;
    personal_email: string;
    role_title: string;
    department: string;
    employment_status: HrEmploymentStatus;
    entity_id: string | null;
    start_date: string | null;
    end_date: string | null;
    manager_name: string;
    location: string;
    notes: string;
  }>,
  opts?: { created_by?: string | null; activity_note?: string },
): Promise<HrEmployee> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('hr_employees')
    .update(patch)
    .eq('id', id)
    .select('*, ops_entities(id, name)')
    .single();
  if (error) throw error;
  const emp = data as HrEmployee;

  if (patch.employment_status) {
    await createEmployeeActivity({
      employee_id: id,
      activity_type: 'status_change',
      title: `Status → ${patch.employment_status}`,
      body: opts?.activity_note?.trim() ?? '',
      status: patch.employment_status,
      created_by: opts?.created_by ?? null,
    });
  } else if (opts?.activity_note?.trim()) {
    await createEmployeeActivity({
      employee_id: id,
      activity_type: 'note',
      title: 'Profile updated',
      body: opts.activity_note.trim(),
      created_by: opts.created_by ?? null,
    });
  }

  return emp;
}

export async function listChecklistsForEmployee(
  employeeId: string,
): Promise<HrOnboardingChecklist[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('hr_onboarding_checklists')
    .select('*, hr_employees(id, full_name, role_title, employment_status)')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as HrOnboardingChecklist[];
}

export async function listChecklists(kind: HrChecklistKind): Promise<HrOnboardingChecklist[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('hr_onboarding_checklists')
    .select(
      '*, hr_employees(id, full_name, role_title, employment_status)',
    )
    .eq('kind', kind)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as HrOnboardingChecklist[];
}

export async function listChecklistItems(checklistId: string): Promise<HrChecklistItem[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('hr_checklist_items')
    .select('*')
    .eq('checklist_id', checklistId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as HrChecklistItem[];
}

function fallbackTemplateItems(kind: HrChecklistKind): HrTemplateItemSeed[] {
  if (kind === 'talent_acquisition') return DEFAULT_TALENT_ACQUISITION_ITEMS;
  if (kind === 'onboarding') return DEFAULT_ONBOARDING_ITEMS;
  return DEFAULT_OFFBOARDING_ITEMS;
}

async function loadTemplateSeeds(
  kind: HrChecklistKind,
): Promise<{ slug: string; seeds: HrTemplateItemSeed[] }> {
  const slug = HR_TEMPLATE_SLUGS[kind];
  const sb = requireSupabase();
  try {
    const { data: tmpl, error } = await sb
      .from('hr_checklist_templates')
      .select('id, slug')
      .eq('slug', slug)
      .eq('active', true)
      .maybeSingle();
    if (error || !tmpl) {
      return { slug, seeds: fallbackTemplateItems(kind) };
    }
    const { data: rows, error: itemsErr } = await sb
      .from('hr_checklist_template_items')
      .select('*')
      .eq('template_id', tmpl.id)
      .order('sort_order', { ascending: true });
    if (itemsErr || !rows?.length) {
      return { slug, seeds: fallbackTemplateItems(kind) };
    }
    const seeds = (rows as HrChecklistTemplateItem[]).map((r) => ({
      title: r.title,
      category: r.category,
      sort_order: r.sort_order,
      system_hook: r.system_hook,
      assignee_hint: r.assignee_hint,
      scope: (r.scope as HrItemScope) || 'parent',
    }));
    return { slug: tmpl.slug, seeds };
  } catch {
    return { slug, seeds: fallbackTemplateItems(kind) };
  }
}

function statusForChecklistKind(kind: HrChecklistKind): HrEmploymentStatus | null {
  if (kind === 'talent_acquisition') return 'prospect';
  if (kind === 'onboarding') return 'onboarding';
  if (kind === 'offboarding') return 'offboarding';
  return null;
}

export async function startChecklist(input: {
  employee_id: string;
  kind: HrChecklistKind;
  created_by?: string | null;
  notes?: string;
  /** When false, do not change employment_status (e.g. create-as-prospect). */
  update_employee_status?: boolean;
  template_slug?: string;
}): Promise<{ checklist: HrOnboardingChecklist; items: HrChecklistItem[] }> {
  const sb = requireSupabase();
  const { slug, seeds } = await loadTemplateSeeds(input.kind);
  const templateSlug = input.template_slug?.trim() || slug;

  const { data: checklist, error } = await sb
    .from('hr_onboarding_checklists')
    .insert({
      employee_id: input.employee_id,
      kind: input.kind,
      status: 'in_progress',
      template_slug: templateSlug,
      started_at: new Date().toISOString(),
      notes: input.notes?.trim() ?? '',
      created_by: input.created_by ?? null,
    })
    .select('*, hr_employees(id, full_name, role_title, employment_status)')
    .single();
  if (error) throw error;

  const itemRows = seeds.map((s) => ({
    checklist_id: checklist.id,
    title: s.title,
    category: s.category,
    sort_order: s.sort_order,
    system_hook: s.system_hook,
    assignee_hint: s.assignee_hint,
    scope: s.scope ?? 'parent',
    status: 'todo' as const,
  }));

  const { data: items, error: itemsErr } = await sb
    .from('hr_checklist_items')
    .insert(itemRows)
    .select('*')
    .order('sort_order', { ascending: true });
  if (itemsErr) throw itemsErr;

  if (input.update_employee_status !== false) {
    const nextStatus = statusForChecklistKind(input.kind);
    if (nextStatus) {
      await sb
        .from('hr_employees')
        .update({ employment_status: nextStatus })
        .eq('id', input.employee_id);
    }
  }

  const kindLabel =
    input.kind === 'talent_acquisition'
      ? 'Talent acquisition'
      : input.kind === 'onboarding'
        ? 'Onboarding'
        : 'Offboarding';

  await createEmployeeActivity({
    employee_id: input.employee_id,
    activity_type: 'checklist',
    title: `${kindLabel} checklist started`,
    body: templateSlug,
    related_checklist_id: checklist.id,
    status: 'in_progress',
    created_by: input.created_by ?? null,
  });

  return {
    checklist: checklist as HrOnboardingChecklist,
    items: (items ?? []) as HrChecklistItem[],
  };
}

/**
 * After offer accepted: complete open talent-acquisition runs and start Signent/TAGE onboarding.
 */
export async function advanceProspectToOnboarding(input: {
  employee_id: string;
  created_by?: string | null;
  notes?: string;
}): Promise<{
  employee: HrEmployee;
  onboarding: { checklist: HrOnboardingChecklist; items: HrChecklistItem[] };
}> {
  const sb = requireSupabase();
  const existing = await listChecklistsForEmployee(input.employee_id);
  const openTa = existing.filter(
    (c) =>
      c.kind === 'talent_acquisition' &&
      (c.status === 'open' || c.status === 'in_progress'),
  );

  for (const ta of openTa) {
    const items = await listChecklistItems(ta.id);
    const offerItem = items.find((i) =>
      /offer accepted/i.test(i.title),
    );
    if (offerItem && offerItem.status !== 'done' && offerItem.status !== 'na') {
      await updateChecklistItemStatus(offerItem.id, 'done');
    }
    await sb
      .from('hr_onboarding_checklists')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
      })
      .eq('id', ta.id);
  }

  await sb
    .from('hr_employees')
    .update({ employment_status: 'onboarding' })
    .eq('id', input.employee_id);

  await createEmployeeActivity({
    employee_id: input.employee_id,
    activity_type: 'status_change',
    title: 'Advanced to onboarding',
    body:
      input.notes?.trim() ||
      'Offer accepted — talent acquisition closed; Signent/TAGE onboarding started.',
    status: 'onboarding',
    created_by: input.created_by ?? null,
  });

  const onboarding = await startChecklist({
    employee_id: input.employee_id,
    kind: 'onboarding',
    created_by: input.created_by ?? null,
    notes: input.notes,
    update_employee_status: false,
  });

  const employee = await getEmployee(input.employee_id);
  return { employee, onboarding };
}

export async function updateChecklistItemStatus(
  id: string,
  status: HrItemStatus,
): Promise<HrChecklistItem> {
  const sb = requireSupabase();
  const { data: prev } = await sb
    .from('hr_checklist_items')
    .select('status, title, checklist_id')
    .eq('id', id)
    .maybeSingle();
  const patch: { status: HrItemStatus; completed_at: string | null } = {
    status,
    completed_at: status === 'done' ? new Date().toISOString() : null,
  };
  const { data, error } = await sb
    .from('hr_checklist_items')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  const row = data as HrChecklistItem;
  if ((prev?.status as string | undefined) !== status) {
    logAuditCompletion({
      eventType: 'hr_checklist_item_update',
      portal: 'human-resources',
      entityType: 'hr_checklist_item',
      entityId: id,
      title: (prev?.title as string | undefined) ?? row.title,
      fromStatus: (prev?.status as string | undefined) ?? null,
      toStatus: status,
      completedAt: row.completed_at,
      extra: { checklist_id: row.checklist_id },
    });
  }
  return row;
}

export async function completeChecklist(id: string): Promise<HrOnboardingChecklist> {
  const sb = requireSupabase();
  const { data: prev } = await sb
    .from('hr_onboarding_checklists')
    .select('status, kind, employee_id')
    .eq('id', id)
    .maybeSingle();
  const { data, error } = await sb
    .from('hr_onboarding_checklists')
    .update({
      status: 'complete',
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*, hr_employees(id, full_name, role_title, employment_status)')
    .single();
  if (error) throw error;

  const kind = (data as HrOnboardingChecklist).kind;
  const employeeId = (data as HrOnboardingChecklist).employee_id;
  if (kind === 'onboarding') {
    await sb
      .from('hr_employees')
      .update({ employment_status: 'active' })
      .eq('id', employeeId);
  } else if (kind === 'offboarding') {
    await sb
      .from('hr_employees')
      .update({
        employment_status: 'terminated',
        end_date: new Date().toISOString().slice(0, 10),
      })
      .eq('id', employeeId);
  }
  // talent_acquisition complete alone does not change status — use advanceProspectToOnboarding

  const checklist = data as HrOnboardingChecklist;
  const kindLabel =
    kind === 'talent_acquisition'
      ? 'Talent acquisition'
      : kind === 'onboarding'
        ? 'Onboarding'
        : 'Offboarding';

  await createEmployeeActivity({
    employee_id: employeeId,
    activity_type: 'checklist',
    title: `${kindLabel} checklist completed`,
    related_checklist_id: id,
    status: 'complete',
  });

  logAuditCompletion({
    eventType: 'hr_checklist_complete',
    portal: 'human-resources',
    entityType: 'hr_checklist',
    entityId: id,
    title: checklist.hr_employees?.full_name ?? kind,
    fromStatus: (prev?.status as string | undefined) ?? null,
    toStatus: 'complete',
    completedAt: checklist.completed_at,
    extra: { kind, employee_id: employeeId },
  });
  return checklist;
}

export async function listComplianceControls(opts?: {
  entityId?: string | 'parent' | 'all';
  area?: string | 'all';
  source?: HrControlSource | 'all';
  status?: HrControlStatus | 'all';
}): Promise<HrComplianceControl[]> {
  const sb = requireSupabase();
  let query = sb
    .from('hr_compliance_controls')
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
  return (data ?? []) as HrComplianceControl[];
}

export async function createComplianceControl(input: {
  title: string;
  description?: string;
  entity_id?: string | null;
  control_key?: string;
  area?: string;
  document_kind?: string;
  evidence_expectation?: string;
  source?: HrControlSource;
  applies_to_parent?: boolean;
  applies_to_entities?: boolean;
  cadence?: HrComplianceCadence;
  owner_role?: string;
  next_due_at?: string | null;
  notes?: string;
  evidence_notes?: string;
  created_by?: string | null;
}): Promise<HrComplianceControl> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('hr_compliance_controls')
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
      owner_role: input.owner_role?.trim() || 'HR',
      next_due_at: input.next_due_at || null,
      notes: input.notes?.trim() ?? '',
      evidence_notes: input.evidence_notes?.trim() ?? '',
      created_by: input.created_by ?? null,
    })
    .select('*, ops_entities(id, name)')
    .single();
  if (error) throw error;
  return data as HrComplianceControl;
}

export async function updateComplianceControl(
  id: string,
  patch: Partial<{
    title: string;
    description: string;
    status: HrControlStatus;
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
    cadence: HrComplianceCadence;
  }>,
): Promise<HrComplianceControl> {
  const sb = requireSupabase();
  let fromStatus: string | null = null;
  let title: string | null = null;
  if (patch.status !== undefined) {
    const { data: prev } = await sb
      .from('hr_compliance_controls')
      .select('status, title')
      .eq('id', id)
      .maybeSingle();
    fromStatus = (prev?.status as string | undefined) ?? null;
    title = (prev?.title as string | undefined) ?? null;
  }
  const { data, error } = await sb
    .from('hr_compliance_controls')
    .update(patch)
    .eq('id', id)
    .select('*, ops_entities(id, name)')
    .single();
  if (error) throw error;
  const row = data as HrComplianceControl;
  if (patch.status !== undefined && fromStatus !== patch.status) {
    logAuditCompletion({
      eventType:
        patch.status === 'compliant' ? 'audit_control_reviewed' : 'audit_control_status',
      portal: 'human-resources',
      entityType: 'hr_compliance_control',
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

export async function markHrControlReviewed(
  control: HrComplianceControl,
): Promise<HrComplianceControl> {
  const patch = buildMarkReviewedPatch(control);
  return updateComplianceControl(control.id, {
    status: patch.status as HrControlStatus,
    last_reviewed_at: patch.last_reviewed_at,
    next_due_at: patch.next_due_at,
  });
}

export type UploadHrEvidenceResult =
  | { ok: true; control: HrComplianceControl }
  | { ok: false; message: string };

export async function uploadHrControlEvidence(input: {
  control: HrComplianceControl;
  file: File;
}): Promise<UploadHrEvidenceResult> {
  const sb = requireSupabase();
  const path = buildAuditEvidencePath('hr', input.control.id, input.file.name);
  const { error: upErr } = await sb.storage.from(AUDIT_EVIDENCE_BUCKET).upload(path, input.file, {
    contentType: input.file.type || 'application/octet-stream',
    upsert: false,
  });
  if (upErr) {
    return { ok: false, message: upErr.message || String(upErr) };
  }
  try {
    const control = await updateComplianceControl(input.control.id, {
      evidence_storage_path: path,
      evidence_file_name: input.file.name,
      evidence_mime_type: input.file.type || '',
    });
    return { ok: true, control };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getHrEvidenceSignedUrl(
  storagePath: string,
  expiresIn = 3600,
): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await requireSupabase()
    .storage.from(AUDIT_EVIDENCE_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error) return null;
  return data.signedUrl ?? null;
}

export function isControlOverdue(c: HrComplianceControl): boolean {
  return isAuditControlOverdue(c);
}

export async function listEmployeeDocuments(
  employeeId: string,
): Promise<HrEmployeeDocument[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('hr_employee_documents')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as HrEmployeeDocument[];
}

export async function createEmployeeDocument(input: {
  employee_id: string;
  title: string;
  category?: HrDocCategory;
  doc_kind?: HrDocKind;
  file_url?: string;
  related_control_key?: string;
  notes?: string;
  created_by?: string | null;
}): Promise<HrEmployeeDocument> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('hr_employee_documents')
    .insert({
      employee_id: input.employee_id,
      title: input.title.trim(),
      category: input.category ?? 'tenure',
      doc_kind: input.doc_kind ?? 'file',
      file_url: input.file_url?.trim() ?? '',
      related_control_key: input.related_control_key?.trim() ?? '',
      notes: input.notes?.trim() ?? '',
      created_by: input.created_by ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  const doc = data as HrEmployeeDocument;

  await createEmployeeActivity({
    employee_id: input.employee_id,
    activity_type: 'document',
    title: `Document added: ${doc.title}`,
    body: doc.notes || doc.file_url || '',
    related_document_id: doc.id,
    status: doc.category,
    created_by: input.created_by ?? null,
  });

  return doc;
}

export async function listEmployeeActivities(
  employeeId: string,
): Promise<HrEmployeeActivity[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('hr_employee_activities')
    .select('*')
    .eq('employee_id', employeeId)
    .order('occurred_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as HrEmployeeActivity[];
}

export async function createEmployeeActivity(input: {
  employee_id: string;
  activity_type?: HrActivityType;
  title: string;
  body?: string;
  related_checklist_id?: string | null;
  related_document_id?: string | null;
  system_hook?: HrSystemHook | string | null;
  status?: string;
  occurred_at?: string;
  created_by?: string | null;
}): Promise<HrEmployeeActivity> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('hr_employee_activities')
    .insert({
      employee_id: input.employee_id,
      activity_type: input.activity_type ?? 'note',
      title: input.title.trim(),
      body: input.body?.trim() ?? '',
      related_checklist_id: input.related_checklist_id ?? null,
      related_document_id: input.related_document_id ?? null,
      system_hook: input.system_hook ?? null,
      status: input.status ?? '',
      occurred_at: input.occurred_at ?? new Date().toISOString(),
      created_by: input.created_by ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as HrEmployeeActivity;
}
