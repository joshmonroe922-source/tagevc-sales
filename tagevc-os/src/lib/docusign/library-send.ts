/**
 * Document Library → DocuSign send with autofill (human-confirmed).
 */

import { randomUUID } from 'crypto';
import { createEnvelope } from '@/lib/docusign/envelopes';
import { getDocuSignMode, isDocuSignConfigured } from '@/lib/docusign/config';
import {
  buildAutofillTabs,
  type AutofillSourceRecord,
} from '@/lib/docusign/autofill';
import {
  dispatchPreparedDocuSignSend,
  prepareDocuSignSendIntent,
} from '@/lib/docusign/send-intents-repo';

export async function sendLibraryDocumentForSignature(input: {
  entityId: string;
  docId: string;
  emailSubject: string;
  content: string;
  signerName: string;
  signerEmail: string;
  actorId: string;
  explicitHumanConfirm: boolean;
  autofill?: AutofillSourceRecord | null;
}): Promise<
  | { ok: true; envelopeId: string; mode: 'live' | 'mock' }
  | { ok: false; error: string }
> {
  if (!input.explicitHumanConfirm) {
    return { ok: false, error: 'Human confirmation required' };
  }
  if (!input.signerEmail?.includes('@')) {
    return { ok: false, error: 'signer email required' };
  }

  const autofillTabs = input.autofill
    ? buildAutofillTabs(input.autofill)
    : null;
  const tabNote = autofillTabs
    ? `\n\n--- Autofill fields ---\n${Object.entries(autofillTabs.tabs)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')}`
    : '';
  const content = `${input.content}${tabNote}`;
  const mode = getDocuSignMode();

  try {
    const intent = await prepareDocuSignSendIntent({
      requestId: `lib-${input.docId}-${randomUUID().slice(0, 8)}`,
      operationKind: 'document_send',
      docId: input.docId,
      entityId: input.entityId,
      emailSubject: input.emailSubject,
      content,
      explicitHumanApproval: true,
      actorId: input.actorId,
    });

    if (isDocuSignConfigured()) {
      const result = await dispatchPreparedDocuSignSend({
        intent,
        dispatch: (leased) =>
          createEnvelope({
            emailSubject: input.emailSubject,
            documentName: `${input.docId}.txt`,
            documentText: content,
            signers: [
              {
                name: input.signerName.trim() || input.signerEmail.trim(),
                email: input.signerEmail.trim(),
              },
            ],
            status: 'sent',
            transactionId: leased.provider_transaction_id,
            intentId: leased.intent_id,
            entityId: input.entityId,
            operationKind: 'document_send',
            docId: input.docId,
          }),
      });
      return { ok: true, envelopeId: result.envelopeId, mode };
    }

    const result = await dispatchPreparedDocuSignSend({
      intent,
      dispatch: async (leased) => ({
        envelopeId: `ENV-LIB-${leased.request_id.slice(0, 8)}`,
        status: 'sent',
        raw: { mode: 'mock', autofill: autofillTabs?.tabs ?? null },
      }),
    });
    return { ok: true, envelopeId: result.envelopeId, mode };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'library_send_failed',
    };
  }
}
