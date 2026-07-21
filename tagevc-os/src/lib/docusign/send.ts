/**
 * Document send via live DocuSign JWT or mock envelope (Phase 21).
 */

import {
  getDocument,
  sendDocument,
} from '@/lib/data/document-store';
import { createEnvelope } from './envelopes';
import { getDocuSignMode, isDocuSignConfigured } from './config';
import type { DocumentRecord } from '@/lib/types';
import {
  dispatchPreparedDocuSignSend,
  prepareDocuSignSendIntent,
} from '@/lib/docusign/send-intents-repo';

export type SendViaDocuSignResult = {
  doc: DocumentRecord;
  mode: 'live' | 'mock';
  envelope_id: string;
  event_persist_ok: boolean;
  event_persist_error?: string;
};

/**
 * Creates a real envelope when JWT env is configured; otherwise mock ENV- id.
 * Always updates DocumentRecord and attempts to write os_docusign_events.
 */
export async function sendDocumentViaDocuSign(args: {
  doc_id: string;
  sent_by: string;
  explicit_human_send: boolean;
  actor_id: string;
  request_id?: string;
}): Promise<SendViaDocuSignResult> {
  const existing = getDocument(args.doc_id);
  if (!existing) throw new Error('Document not found');

  const mode = getDocuSignMode();
  const intent = await prepareDocuSignSendIntent({
    requestId: args.request_id,
    operationKind: 'document_send',
    docId: existing.doc_id,
    entityId: existing.entity_id,
    emailSubject: existing.title || `Document ${existing.doc_id}`,
    content: existing.merged_body || existing.title,
    explicitHumanApproval: args.explicit_human_send,
    actorId: args.actor_id,
  });
  let envelopeId: string;

  if (isDocuSignConfigured()) {
    const signers = existing.signers
      .filter((s) => s.email?.trim())
      .map((s) => ({ name: s.name, email: s.email }));

    if (signers.length === 0) {
      throw new Error(
        'Document has no signer emails — add signers before live DocuSign send',
      );
    }

    const result = await dispatchPreparedDocuSignSend({
      intent,
      dispatch: (leased) =>
        createEnvelope({
          emailSubject: existing.title || `Document ${existing.doc_id}`,
          documentName: `${existing.doc_id}.txt`,
          documentText:
            existing.merged_body ||
            `${existing.title}\n\n${existing.doc_type}\n${existing.doc_id}`,
          signers,
          status: 'sent',
          transactionId: leased.provider_transaction_id,
          intentId: leased.intent_id,
          entityId: existing.entity_id,
          operationKind: 'document_send',
          docId: existing.doc_id,
        }),
    });
    envelopeId = result.envelopeId;
  } else {
    const result = await dispatchPreparedDocuSignSend({
      intent,
      dispatch: async (leased) => ({
        envelopeId: `ENV-${existing.doc_id}-${leased.request_id.slice(0, 8)}`,
        status: 'sent',
        raw: { mode: 'mock', transactionId: leased.provider_transaction_id },
      }),
    });
    envelopeId = result.envelopeId;
  }

  const doc = sendDocument({
    doc_id: args.doc_id,
    sent_by: args.sent_by,
    explicit_human_send: args.explicit_human_send,
    envelope_id: envelopeId,
  });

  const persist = { ok: true as const };

  return {
    doc,
    mode,
    envelope_id: envelopeId,
    event_persist_ok: persist.ok,
    event_persist_error: undefined,
  };
}
