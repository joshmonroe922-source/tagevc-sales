import { createPersistClient } from '@/lib/supabase/persist-client';
import type { DocumentRecord } from '@/lib/types';
import type { AppRole } from '@/lib/types/roles';

function parseVisibleRoles(raw: unknown): AppRole[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  return raw.filter((r): r is AppRole => typeof r === 'string') as AppRole[];
}

function docToRow(doc: DocumentRecord, includeVisibleRoles: boolean) {
  const row: Record<string, unknown> = {
    id: doc.id,
    doc_id: doc.doc_id,
    entity_id: doc.entity_id,
    deal_or_task_id: doc.deal_or_task_id,
    doc_type: doc.doc_type,
    template_id: doc.template_id,
    title: doc.title,
    library_path: doc.library_path,
    folder: doc.folder,
    status: doc.status,
    envelope_id: doc.envelope_id,
    merged_body: doc.merged_body,
    merge_values: doc.merge_values,
    signers: doc.signers,
    sent_by: doc.sent_by,
    sent_at: doc.sent_at,
    completed_at: doc.completed_at,
    content_hash: doc.content_hash,
    notes: doc.notes,
    ai_review: doc.ai_review,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
  if (includeVisibleRoles) {
    row.visible_roles = doc.visible_roles;
  }
  return row;
}

function rowToDoc(row: Record<string, unknown>): DocumentRecord {
  return {
    id: String(row.id),
    doc_id: String(row.doc_id),
    entity_id: (row.entity_id as string | null) ?? null,
    deal_or_task_id: (row.deal_or_task_id as string | null) ?? null,
    doc_type: row.doc_type as DocumentRecord['doc_type'],
    template_id: (row.template_id as string | null) ?? null,
    title: String(row.title),
    library_path: String(row.library_path ?? ''),
    folder: String(row.folder ?? ''),
    status: row.status as DocumentRecord['status'],
    envelope_id: (row.envelope_id as string | null) ?? null,
    merged_body: (row.merged_body as string | null) ?? null,
    merge_values: (row.merge_values as Record<string, string>) ?? {},
    signers:
      (row.signers as DocumentRecord['signers']) ??
      ([] as DocumentRecord['signers']),
    sent_by: (row.sent_by as string | null) ?? null,
    sent_at: (row.sent_at as string | null) ?? null,
    completed_at: (row.completed_at as string | null) ?? null,
    content_hash: (row.content_hash as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    visible_roles: parseVisibleRoles(row.visible_roles),
    ai_review: (row.ai_review as DocumentRecord['ai_review']) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function fetchAllDocuments(): Promise<DocumentRecord[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_documents')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('fetchAllDocuments', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToDoc(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllDocuments', e);
    return null;
  }
}

async function upsertDocs(
  docs: DocumentRecord[],
  includeVisibleRoles: boolean,
): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createPersistClient();
  const { error } = await supabase
    .from('os_documents')
    .upsert(
      docs.map((d) => docToRow(d, includeVisibleRoles)),
      { onConflict: 'doc_id' },
    );
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function syncDocuments(docs: DocumentRecord[]): Promise<boolean> {
  try {
    if (docs.length === 0) return true;
    const first = await upsertDocs(docs, true);
    if (first.ok) return true;
    // Column may not exist until phase80 SQL is applied — retry without it.
    if (
      first.message &&
      /visible_roles/i.test(first.message)
    ) {
      console.warn(
        'syncDocuments: visible_roles column missing; syncing without ACL field',
      );
      const retry = await upsertDocs(docs, false);
      if (retry.ok) return true;
      console.error('syncDocuments', retry.message);
      return false;
    }
    console.error('syncDocuments', first.message);
    return false;
  } catch (e) {
    console.error('syncDocuments', e);
    return false;
  }
}
