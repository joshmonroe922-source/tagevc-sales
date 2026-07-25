/**
 * HRIS private document vault — metadata in os_hris_documents,
 * binaries in Supabase storage bucket `hris-private`.
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { addEmployeeLink } from '@/lib/hris/employees';
import { writeAuditEvent } from '@/lib/audit/write';

export const HRIS_PRIVATE_BUCKET = 'hris-private';

export type HrisDocKind =
  | 'offer'
  | 'nda'
  | 'i9'
  | 'handbook'
  | 'contract'
  | 'id'
  | 'other'
  | 'signed';

export type HrisDocumentRow = {
  id: string;
  employee_id: string;
  step_id: string | null;
  kind: HrisDocKind;
  title: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  storage_path: string;
  docusign_envelope_id: string | null;
  docusign_status: string | null;
  created_at: string;
};

export async function listEmployeeDocuments(
  employeeId: string,
): Promise<{ rows: HrisDocumentRow[]; error?: string }> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_hris_documents')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => ({
        id: String(r.id),
        employee_id: String(r.employee_id),
        step_id: (r.step_id as string) ?? null,
        kind: r.kind as HrisDocKind,
        title: String(r.title),
        file_name: String(r.file_name),
        mime_type: String(r.mime_type ?? 'application/octet-stream'),
        byte_size: Number(r.byte_size ?? 0),
        storage_path: String(r.storage_path),
        docusign_envelope_id: (r.docusign_envelope_id as string) ?? null,
        docusign_status: (r.docusign_status as string) ?? null,
        created_at: String(r.created_at),
      })),
    };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'list docs failed',
    };
  }
}

export async function uploadHrisDocument(input: {
  employeeId: string;
  entityId?: string | null;
  stepId?: string | null;
  kind: HrisDocKind;
  title: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer | Uint8Array;
  uploadedBy?: string | null;
}): Promise<
  | { ok: true; doc: HrisDocumentRow; signedUrl?: string | null }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    let entityId = input.entityId?.trim() || '';
    if (!entityId) {
      const { data: emp } = await sb
        .from('os_hris_employees')
        .select('entity_id')
        .eq('id', input.employeeId)
        .maybeSingle();
      entityId = String(emp?.entity_id ?? '');
    }
    // Prefer entity-scoped paths; fall back to legacy employee-only if unknown.
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = entityId
      ? `${entityId}/${input.employeeId}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`
      : `${input.employeeId}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
    const { error: upErr } = await sb.storage
      .from(HRIS_PRIVATE_BUCKET)
      .upload(path, input.bytes, {
        contentType: input.mimeType || 'application/octet-stream',
        upsert: false,
      });

    if (upErr) {
      // Fail soft: still record metadata with pending storage note
      const { data, error } = await sb
        .from('os_hris_documents')
        .insert({
          employee_id: input.employeeId,
          step_id: input.stepId ?? null,
          kind: input.kind,
          title: input.title,
          file_name: input.fileName,
          mime_type: input.mimeType,
          byte_size: input.bytes.byteLength,
          storage_path: path,
          uploaded_by: input.uploadedBy ?? null,
          detail: {
            storage_error: upErr.message,
            pending_upload: true,
            bucket: HRIS_PRIVATE_BUCKET,
          },
        })
        .select('*')
        .maybeSingle();
      if (error || !data) {
        return {
          ok: false,
          error: `Storage upload failed (${upErr.message}). Create private bucket '${HRIS_PRIVATE_BUCKET}'.`,
        };
      }
      await addEmployeeLink({
        employee_id: input.employeeId,
        kind: 'document',
        ref_id: String(data.id),
        label: input.title,
      });
      return {
        ok: true,
        doc: {
          id: String(data.id),
          employee_id: input.employeeId,
          step_id: input.stepId ?? null,
          kind: input.kind,
          title: input.title,
          file_name: input.fileName,
          mime_type: input.mimeType,
          byte_size: input.bytes.byteLength,
          storage_path: path,
          docusign_envelope_id: null,
          docusign_status: null,
          created_at: String(data.created_at),
        },
      };
    }

    const { data, error } = await sb
      .from('os_hris_documents')
      .insert({
        employee_id: input.employeeId,
        step_id: input.stepId ?? null,
        kind: input.kind,
        title: input.title,
        file_name: input.fileName,
        mime_type: input.mimeType,
        byte_size: input.bytes.byteLength,
        storage_path: path,
        uploaded_by: input.uploadedBy ?? null,
        detail: { bucket: HRIS_PRIVATE_BUCKET },
      })
      .select('*')
      .maybeSingle();
    if (error || !data) {
      return { ok: false, error: error?.message ?? 'Document metadata insert failed' };
    }

    await addEmployeeLink({
      employee_id: input.employeeId,
      kind: 'document',
      ref_id: String(data.id),
      label: input.title,
    });

    await writeAuditEvent({
      action: 'hris_action',
      title: `HRIS document uploaded · ${input.title}`,
      object_type: 'hris_document',
      object_id: String(data.id),
      metadata: { kind: input.kind, employee_id: input.employeeId },
    });

    const { data: signed } = await sb.storage
      .from(HRIS_PRIVATE_BUCKET)
      .createSignedUrl(path, 60 * 30);

    return {
      ok: true,
      doc: {
        id: String(data.id),
        employee_id: input.employeeId,
        step_id: input.stepId ?? null,
        kind: input.kind,
        title: input.title,
        file_name: input.fileName,
        mime_type: input.mimeType,
        byte_size: input.bytes.byteLength,
        storage_path: path,
        docusign_envelope_id: null,
        docusign_status: null,
        created_at: String(data.created_at),
      },
      signedUrl: signed?.signedUrl ?? null,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Upload failed',
    };
  }
}

export async function getHrisDocumentSignedUrl(
  docId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_hris_documents')
      .select('storage_path')
      .eq('id', docId)
      .maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? 'Not found' };
    const { data: signed, error: sErr } = await sb.storage
      .from(HRIS_PRIVATE_BUCKET)
      .createSignedUrl(String(data.storage_path), 60 * 30);
    if (sErr || !signed?.signedUrl) {
      return { ok: false, error: sErr?.message ?? 'Signed URL failed' };
    }
    return { ok: true, url: signed.signedUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'failed' };
  }
}
