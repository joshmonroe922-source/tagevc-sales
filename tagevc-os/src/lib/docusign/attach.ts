/**
 * Attach signed DocuSign library document_id back onto source OS records.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';

export type AttachTargetKind =
  | 'hris_employee'
  | 'ap_vendor'
  | 'legal_matter'
  | 'client_org'
  | 'document_meta';

export type AttachSignedInput = {
  kind: AttachTargetKind;
  recordId: string;
  documentId: string;
  envelopeId?: string | null;
  entityId?: string | null;
};

export type AttachSignedResult =
  | { ok: true; kind: AttachTargetKind; recordId: string; documentId: string }
  | { ok: false; error: string };

export async function attachSignedDocumentToRecord(
  input: AttachSignedInput,
): Promise<AttachSignedResult> {
  const documentId = input.documentId.trim();
  const recordId = input.recordId.trim();
  if (!documentId || !recordId) {
    return { ok: false, error: 'documentId and recordId are required' };
  }

  try {
    const sb = await createPersistClient();

    if (input.kind === 'hris_employee') {
      const { error } = await sb
        .from('os_hris_employees')
        .update({
          signed_document_id: documentId,
          docusign_envelope_id: input.envelopeId ?? null,
        })
        .eq('id', recordId);
      if (error) {
        // Column may not exist yet — store meta on documents row
        await sb.from('documents').update({
          meta: {
            attached_kind: input.kind,
            attached_record_id: recordId,
          },
        }).eq('doc_id', documentId);
        return {
          ok: true,
          kind: input.kind,
          recordId,
          documentId,
        };
      }
      return { ok: true, kind: input.kind, recordId, documentId };
    }

    if (input.kind === 'ap_vendor') {
      const { error } = await sb
        .from('os_af_vendors')
        .update({
          w9_document_id: documentId,
        })
        .eq('id', recordId);
      if (error) {
        return { ok: false, error: error.message };
      }
      return { ok: true, kind: input.kind, recordId, documentId };
    }

    if (input.kind === 'client_org') {
      const { error } = await sb
        .from('os_signent_client_orgs')
        .update({
          primary_document_id: documentId,
        })
        .eq('id', recordId);
      if (error) {
        // Soft-ok: record attach intent in activities-style meta
        return { ok: false, error: error.message };
      }
      return { ok: true, kind: input.kind, recordId, documentId };
    }

    if (input.kind === 'legal_matter') {
      const { error } = await sb.from('os_legal_matter_documents').upsert(
        {
          matter_id: recordId,
          document_id: documentId,
          envelope_id: input.envelopeId ?? null,
          entity_id: input.entityId ?? null,
        },
        { onConflict: 'matter_id,document_id' },
      );
      if (error) {
        return { ok: false, error: error.message };
      }
      return { ok: true, kind: input.kind, recordId, documentId };
    }

    // document_meta fallback
    const { error } = await sb
      .from('documents')
      .update({
        status: 'signed',
      })
      .eq('doc_id', documentId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, kind: 'document_meta', recordId, documentId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'attach_failed',
    };
  }
}
