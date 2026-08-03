/**
 * DocuSign port — thin wrapper over existing spine DocuSign (library SoT).
 * Campaign stores library_document_id only; never uploads duplicate PDFs.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';

export type SendEnvelopeInput = {
  entityId: string;
  libraryDocumentId: string;
  contactIds: string[];
  campaignId?: string | null;
  enrollmentId?: string | null;
  emailMessage?: string | null;
};

export type SendEnvelopeResult =
  | { ok: true; actionIds: string[] }
  | { ok: false; error: string };

/**
 * Queue envelope actions for the existing DocuSign spine to process.
 * Does not reimplement DocuSign auth.
 */
export async function queueSendEnvelope(
  input: SendEnvelopeInput,
): Promise<SendEnvelopeResult> {
  if (!input.libraryDocumentId) {
    return { ok: false, error: 'library_document_id required' };
  }
  if (!input.contactIds.length) {
    return { ok: false, error: 'contact_ids required' };
  }

  const sb = await createPersistClient({ mode: 'service' });
  const rows = input.contactIds.map((contactId) => ({
    entity_id: input.entityId,
    contact_id: contactId,
    library_document_id: input.libraryDocumentId,
    campaign_id: input.campaignId ?? null,
    journey_enrollment_id: input.enrollmentId ?? null,
    status: 'queued',
  }));

  const { data, error } = await sb
    .from('ecc_envelope_actions')
    .insert(rows)
    .select('id');

  if (error) return { ok: false, error: error.message };

  await sb.from('ecc_library_document_refs').upsert(
    {
      entity_id: input.entityId,
      library_document_id: input.libraryDocumentId,
      title: input.libraryDocumentId,
      allow_email_attach: false,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );

  // Prefer calling existing spine when available (dynamic import fail-soft)
  try {
    const mod = await import('@/lib/docusign/send').catch(() => null);
    if (mod && typeof (mod as { sendFromLibrary?: unknown }).sendFromLibrary === 'function') {
      // Existing spine owns envelope creation; we only recorded the bridge rows.
    }
  } catch {
    // bridge rows are enough for journey goal tracking
  }

  return { ok: true, actionIds: (data ?? []).map((r) => String(r.id)) };
}

export async function markEnvelopeStatus(input: {
  docusignEnvelopeId: string;
  status: string;
}): Promise<void> {
  const sb = await createPersistClient({ mode: 'service' });
  await sb
    .from('ecc_envelope_actions')
    .update({
      status: input.status,
      docusign_envelope_id: input.docusignEnvelopeId,
      updated_at: new Date().toISOString(),
    })
    .eq('docusign_envelope_id', input.docusignEnvelopeId);

  // Goal exit: completed signatures pause/exit NDA journeys
  if (input.status === 'completed') {
    const { data: actions } = await sb
      .from('ecc_envelope_actions')
      .select('journey_enrollment_id, contact_id, entity_id')
      .eq('docusign_envelope_id', input.docusignEnvelopeId);
    for (const a of actions ?? []) {
      if (a.journey_enrollment_id) {
        await sb
          .from('ecc_journey_enrollments')
          .update({
            state: 'completed',
            exited_at: new Date().toISOString(),
            exit_reason: 'docusign_completed',
          })
          .eq('id', a.journey_enrollment_id);
      }
    }
  }
}
