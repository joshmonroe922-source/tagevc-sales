import { requireSupabase } from './supabase';
import type {
  ChecklistStatus,
  ComplianceCadence,
  OpsChecklistItem,
  OpsChecklistTemplate,
  OpsChecklistTemplateItem,
  OpsComplianceItem,
  OpsDefaultFolder,
  OpsDocument,
  OpsEntity,
  OpsEntityStatus,
  OpsEntityType,
  OpsFolder,
} from './opsTypes';
import { entityTypeForTemplateSlug } from './opsTypes';

const ENTITY_DOCS_BUCKET = 'entity-docs';

export async function listEntities(): Promise<OpsEntity[]> {
  const { data, error } = await requireSupabase()
    .from('ops_entities')
    .select('*, sales_leads(id, name, company)')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as OpsEntity[];
}

export async function getEntity(id: string): Promise<OpsEntity | null> {
  const { data, error } = await requireSupabase()
    .from('ops_entities')
    .select('*, sales_leads(id, name, company)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as OpsEntity | null;
}

export async function listChecklistTemplates(): Promise<OpsChecklistTemplate[]> {
  const { data, error } = await requireSupabase()
    .from('ops_checklist_templates')
    .select('*')
    .eq('active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as OpsChecklistTemplate[];
}

export async function listDefaultFolders(): Promise<OpsDefaultFolder[]> {
  const { data, error } = await requireSupabase()
    .from('ops_default_folders')
    .select('*')
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as OpsDefaultFolder[];
}

export type CreateEntityInput = {
  name: string;
  entity_type?: OpsEntityType;
  status?: OpsEntityStatus;
  lead_id?: string | null;
  jurisdiction?: string;
  formed_at?: string | null;
  notes?: string;
  created_by?: string | null;
  /** Template slug: start-business | acquire-business | omit for no checklist clone */
  template_slug?: string | null;
};

export async function createEntity(input: CreateEntityInput): Promise<OpsEntity> {
  const client = requireSupabase();
  let entityType = input.entity_type ?? 'other';
  let templateId: string | null = null;
  let templateItems: OpsChecklistTemplateItem[] = [];

  if (input.template_slug) {
    const { data: tpl, error: tplErr } = await client
      .from('ops_checklist_templates')
      .select('id, entity_type, slug')
      .eq('slug', input.template_slug)
      .eq('active', true)
      .maybeSingle();
    if (tplErr) throw tplErr;
    if (tpl) {
      templateId = tpl.id;
      if (!input.entity_type) {
        entityType = (tpl.entity_type as OpsEntityType) || entityTypeForTemplateSlug(tpl.slug);
      }
      const { data: items, error: itemsErr } = await client
        .from('ops_checklist_template_items')
        .select('*')
        .eq('template_id', tpl.id)
        .order('sort_order');
      if (itemsErr) throw itemsErr;
      templateItems = (items ?? []) as OpsChecklistTemplateItem[];
    }
  }

  const { data: entity, error } = await client
    .from('ops_entities')
    .insert({
      name: input.name.trim(),
      entity_type: entityType,
      status: input.status ?? (entityType === 'launch' ? 'forming' : 'active'),
      lead_id: input.lead_id ?? null,
      jurisdiction: (input.jurisdiction ?? '').trim(),
      formed_at: input.formed_at || null,
      notes: input.notes ?? '',
      created_by: input.created_by ?? null,
    })
    .select('*, sales_leads(id, name, company)')
    .single();
  if (error) throw error;

  const entityId = entity.id as string;

  // Clone default folders
  const defaults = await listDefaultFolders();
  if (defaults.length > 0) {
    const { error: folderErr } = await client.from('ops_folders').insert(
      defaults.map((f) => ({
        entity_id: entityId,
        name: f.name,
        sort_order: f.sort_order,
      })),
    );
    if (folderErr) throw folderErr;
  }

  // Clone checklist from template
  if (templateId && templateItems.length > 0) {
    const { error: checkErr } = await client.from('ops_checklist_items').insert(
      templateItems.map((item) => ({
        entity_id: entityId,
        title: item.title,
        phase: item.phase,
        sort_order: item.sort_order,
        status: 'todo',
      })),
    );
    if (checkErr) throw checkErr;
  }

  return entity as OpsEntity;
}

export async function updateEntity(
  id: string,
  patch: Partial<{
    name: string;
    entity_type: OpsEntityType;
    status: OpsEntityStatus;
    lead_id: string | null;
    jurisdiction: string;
    formed_at: string | null;
    notes: string;
  }>,
): Promise<OpsEntity> {
  const { data, error } = await requireSupabase()
    .from('ops_entities')
    .update(patch)
    .eq('id', id)
    .select('*, sales_leads(id, name, company)')
    .single();
  if (error) throw error;
  return data as OpsEntity;
}

export async function listChecklistItems(entityId: string): Promise<OpsChecklistItem[]> {
  const { data, error } = await requireSupabase()
    .from('ops_checklist_items')
    .select('*')
    .eq('entity_id', entityId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as OpsChecklistItem[];
}

export async function setChecklistItemStatus(
  itemId: string,
  status: ChecklistStatus,
): Promise<void> {
  const { error } = await requireSupabase()
    .from('ops_checklist_items')
    .update({
      status,
      completed_at: status === 'done' ? new Date().toISOString() : null,
    })
    .eq('id', itemId);
  if (error) throw error;
}

export async function listFolders(entityId: string): Promise<OpsFolder[]> {
  const { data, error } = await requireSupabase()
    .from('ops_folders')
    .select('*')
    .eq('entity_id', entityId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as OpsFolder[];
}

export async function listDocuments(entityId: string): Promise<OpsDocument[]> {
  const { data, error } = await requireSupabase()
    .from('ops_documents')
    .select('*')
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as OpsDocument[];
}

export async function createDocumentLink(input: {
  entity_id: string;
  folder_id?: string | null;
  title: string;
  external_url: string;
  notes?: string;
  uploaded_by?: string | null;
}): Promise<OpsDocument> {
  const { data, error } = await requireSupabase()
    .from('ops_documents')
    .insert({
      entity_id: input.entity_id,
      folder_id: input.folder_id ?? null,
      title: input.title.trim(),
      external_url: input.external_url.trim(),
      notes: input.notes ?? '',
      uploaded_by: input.uploaded_by ?? null,
      file_name: '',
      mime_type: '',
      storage_path: '',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as OpsDocument;
}

export type UploadDocumentResult =
  | { ok: true; document: OpsDocument }
  | { ok: false; reason: 'storage_unavailable' | 'error'; message: string };

export async function uploadDocument(input: {
  entity_id: string;
  folder_id?: string | null;
  title: string;
  file: File;
  uploaded_by?: string | null;
  notes?: string;
}): Promise<UploadDocumentResult> {
  const client = requireSupabase();
  const safeName = input.file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${input.entity_id}/${input.folder_id ?? 'unfiled'}/${Date.now()}_${safeName}`;

  const { error: upErr } = await client.storage
    .from(ENTITY_DOCS_BUCKET)
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

  const { data, error } = await client
    .from('ops_documents')
    .insert({
      entity_id: input.entity_id,
      folder_id: input.folder_id ?? null,
      title: input.title.trim() || input.file.name,
      file_name: input.file.name,
      mime_type: input.file.type || '',
      storage_path: path,
      external_url: '',
      notes: input.notes ?? '',
      uploaded_by: input.uploaded_by ?? null,
    })
    .select('*')
    .single();

  if (error) {
    return { ok: false, reason: 'error', message: error.message };
  }

  return { ok: true, document: data as OpsDocument };
}

export async function getDocumentSignedUrl(
  storagePath: string,
  expiresIn = 3600,
): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await requireSupabase()
    .storage.from(ENTITY_DOCS_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error) return null;
  return data.signedUrl;
}

export async function listComplianceForEntity(
  entityId: string,
): Promise<OpsComplianceItem[]> {
  const { data, error } = await requireSupabase()
    .from('ops_compliance_items')
    .select('*')
    .eq('entity_id', entityId)
    .order('next_due_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as OpsComplianceItem[];
}

export async function listUpcomingCompliance(): Promise<OpsComplianceItem[]> {
  const { data, error } = await requireSupabase()
    .from('ops_compliance_items')
    .select('*, ops_entities(id, name)')
    .eq('active', true)
    .not('next_due_at', 'is', null)
    .order('next_due_at', { ascending: true })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as OpsComplianceItem[];
}

export async function createComplianceItem(input: {
  entity_id: string;
  title: string;
  cadence?: ComplianceCadence;
  next_due_at?: string | null;
  notes?: string;
}): Promise<OpsComplianceItem> {
  const { data, error } = await requireSupabase()
    .from('ops_compliance_items')
    .insert({
      entity_id: input.entity_id,
      title: input.title.trim(),
      cadence: input.cadence ?? 'annual',
      next_due_at: input.next_due_at || null,
      notes: input.notes ?? '',
      active: true,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as OpsComplianceItem;
}

export async function updateComplianceItem(
  id: string,
  patch: Partial<{
    title: string;
    cadence: ComplianceCadence;
    next_due_at: string | null;
    last_completed_at: string | null;
    notes: string;
    active: boolean;
  }>,
): Promise<OpsComplianceItem> {
  const { data, error } = await requireSupabase()
    .from('ops_compliance_items')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as OpsComplianceItem;
}

export async function markComplianceComplete(id: string): Promise<OpsComplianceItem> {
  const { data: existing, error: getErr } = await requireSupabase()
    .from('ops_compliance_items')
    .select('*')
    .eq('id', id)
    .single();
  if (getErr) throw getErr;

  const today = new Date().toISOString().slice(0, 10);
  let nextDue: string | null = null;
  const cadence = existing.cadence as ComplianceCadence;

  if (cadence === 'annual') {
    const d = new Date(`${existing.next_due_at ?? today}T12:00:00`);
    d.setFullYear(d.getFullYear() + 1);
    nextDue = d.toISOString().slice(0, 10);
  } else if (cadence === 'monthly') {
    const d = new Date(`${existing.next_due_at ?? today}T12:00:00`);
    d.setMonth(d.getMonth() + 1);
    nextDue = d.toISOString().slice(0, 10);
  } else if (cadence === 'one_time') {
    nextDue = null;
  } else {
    nextDue = existing.next_due_at;
  }

  return updateComplianceItem(id, {
    last_completed_at: today,
    next_due_at: nextDue,
    active: cadence === 'one_time' ? false : existing.active,
  });
}
