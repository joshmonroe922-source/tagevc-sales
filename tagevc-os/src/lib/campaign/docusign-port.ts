/**
 * DocuSign port — thin wrapper over existing spine DocuSign (library SoT).
 * Campaign stores library_document_id only; never uploads duplicate PDFs.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { getLibraryDocumentContent } from '@/lib/campaign/docusign/library';
import { sendLibraryDocumentForSignature } from '@/lib/docusign/library-send';

export type SendEnvelopeInput = {
  entityId: string;
  libraryDocumentId: string;
  contactIds: string[];
  campaignId?: string | null;
  enrollmentId?: string | null;
  emailMessage?: string | null;
  actorId?: string | null;
  /** When true, call spine send immediately (requires human confirm). */
  explicitHumanConfirm?: boolean;
  /** When true (default for journeys), only queue ecc_envelope_actions. */
  queueOnly?: boolean;
};

export type SendEnvelopeResult =
  | { ok: true; actionIds: string[]; envelopeIds?: string[] }
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
  const actionIds = (data ?? []).map((r) => String(r.id));

  // Cache library ref for picker / pack defaults
  try {
    const content = getLibraryDocumentContent(input.libraryDocumentId);
    await sb.from('ecc_library_document_refs').upsert(
      {
        entity_id: input.entityId,
        library_document_id: input.libraryDocumentId,
        title: content?.title || input.libraryDocumentId,
        allow_email_attach: false,
      },
      { onConflict: 'entity_id,library_document_id', ignoreDuplicates: true },
    );
  } catch {
    // refs table optional
  }

  if (input.queueOnly !== false && !input.explicitHumanConfirm) {
    return { ok: true, actionIds };
  }

  // Immediate dispatch (operator confirmed)
  const envelopeIds: string[] = [];
  for (const id of actionIds) {
    const dispatched = await dispatchEnvelopeAction({
      actionId: id,
      actorId: input.actorId || 'system',
      explicitHumanConfirm: Boolean(input.explicitHumanConfirm),
    });
    if (dispatched.ok && dispatched.envelopeId) {
      envelopeIds.push(dispatched.envelopeId);
    }
  }
  return { ok: true, actionIds, envelopeIds };
}

export async function dispatchEnvelopeAction(input: {
  actionId: string;
  actorId: string;
  explicitHumanConfirm: boolean;
}): Promise<
  { ok: true; envelopeId: string } | { ok: false; error: string }
> {
  const sb = await createPersistClient({ mode: 'service' });
  const { data: action } = await sb
    .from('ecc_envelope_actions')
    .select('*')
    .eq('id', input.actionId)
    .maybeSingle();
  if (!action) return { ok: false, error: 'Envelope action not found' };
  if (!action.contact_id) return { ok: false, error: 'contact_id missing' };

  const { data: contact } = await sb
    .from('contacts')
    .select('primary_email, full_name, first_name, last_name')
    .eq('id', action.contact_id)
    .maybeSingle();
  if (!contact?.primary_email) {
    return { ok: false, error: 'Contact has no email' };
  }

  const lib = getLibraryDocumentContent(String(action.library_document_id));
  const content =
    lib?.content ||
    `Please review and sign: ${action.library_document_id}`;
  const title = lib?.title || String(action.library_document_id);

  if (!input.explicitHumanConfirm) {
    // Mock / queue-complete without live send — keeps journey E2E offline-safe
    const mockId = `ENV-ECC-${String(action.id).slice(0, 8)}`;
    await sb
      .from('ecc_envelope_actions')
      .update({
        status: 'sent',
        docusign_envelope_id: mockId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', action.id);
    return { ok: true, envelopeId: mockId };
  }

  const result = await sendLibraryDocumentForSignature({
    entityId: String(action.entity_id),
    docId: String(action.library_document_id),
    emailSubject: title,
    content,
    signerName:
      contact.full_name ||
      [contact.first_name, contact.last_name].filter(Boolean).join(' ') ||
      contact.primary_email,
    signerEmail: String(contact.primary_email),
    actorId: input.actorId,
    explicitHumanConfirm: true,
  });

  if (!result.ok) {
    await sb
      .from('ecc_envelope_actions')
      .update({
        status: 'error',
        updated_at: new Date().toISOString(),
      })
      .eq('id', action.id);
    return { ok: false, error: result.error };
  }

  await sb
    .from('ecc_envelope_actions')
    .update({
      status: 'sent',
      docusign_envelope_id: result.envelopeId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', action.id);

  return { ok: true, envelopeId: result.envelopeId };
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
