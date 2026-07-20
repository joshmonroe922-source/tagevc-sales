/**
 * Document send via live DocuSign JWT or mock envelope (Phase 21).
 */

import {
  getDocument,
  sendDocument,
} from '@/lib/data/document-store';
import { createEnvelope } from './envelopes';
import { insertDocuSignEvent } from './events-repo';
import { getDocuSignMode, isDocuSignConfigured } from './config';
import type { DocumentRecord } from '@/lib/types';

export type SendViaDocuSignResult = {
  doc: DocumentRecord;
  mode: 'live' | 'mock';
  envelope_id: string;
  event_persist_ok: boolean;
  event_persist_error?: string;
};

function inferDealOrTicket(doc: DocumentRecord): {
  deal_id: string | null;
  ticket_id: string | null;
} {
  const ref = doc.deal_or_task_id?.trim() || null;
  if (!ref) return { deal_id: null, ticket_id: null };
  if (/^TKT-/i.test(ref) || /^ticket/i.test(ref)) {
    return { deal_id: null, ticket_id: ref };
  }
  return { deal_id: ref, ticket_id: null };
}

/**
 * Creates a real envelope when JWT env is configured; otherwise mock ENV- id.
 * Always updates DocumentRecord and attempts to write os_docusign_events.
 */
export async function sendDocumentViaDocuSign(args: {
  doc_id: string;
  sent_by: string;
  explicit_human_send: boolean;
}): Promise<SendViaDocuSignResult> {
  const existing = getDocument(args.doc_id);
  if (!existing) throw new Error('Document not found');

  const mode = getDocuSignMode();
  let envelopeId: string;
  let rawPayload: Record<string, unknown> = { mode };

  if (isDocuSignConfigured()) {
    const signers = existing.signers
      .filter((s) => s.email?.trim())
      .map((s) => ({ name: s.name, email: s.email }));

    if (signers.length === 0) {
      throw new Error(
        'Document has no signer emails — add signers before live DocuSign send',
      );
    }

    const result = await createEnvelope({
      emailSubject: existing.title || `Document ${existing.doc_id}`,
      documentName: `${existing.doc_id}.txt`,
      documentText:
        existing.merged_body ||
        `${existing.title}\n\n${existing.doc_type}\n${existing.doc_id}`,
      signers,
      status: 'sent',
    });
    envelopeId = result.envelopeId;
    rawPayload = {
      mode: 'live',
      create_response: result.raw as Record<string, unknown>,
    };
  } else {
    envelopeId = `ENV-${existing.doc_id}-${Date.now().toString(36)}`;
    rawPayload = { mode: 'mock', note: 'DOCUSIGN_* env not configured' };
  }

  const doc = sendDocument({
    doc_id: args.doc_id,
    sent_by: args.sent_by,
    explicit_human_send: args.explicit_human_send,
    envelope_id: envelopeId,
  });

  const links = inferDealOrTicket(doc);
  const persist = await insertDocuSignEvent({
    envelope_id: envelopeId,
    status: 'sent',
    event_type: 'envelope-sent',
    doc_id: doc.doc_id,
    entity_id: doc.entity_id,
    deal_id: links.deal_id,
    ticket_id: links.ticket_id,
    raw_payload: rawPayload,
  });

  return {
    doc,
    mode,
    envelope_id: envelopeId,
    event_persist_ok: persist.ok,
    event_persist_error: persist.ok ? undefined : persist.error,
  };
}
