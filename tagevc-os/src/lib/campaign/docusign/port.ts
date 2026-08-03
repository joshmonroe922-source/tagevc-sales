/**
 * Thin DocuSign port — Document Library is SoT; reuse spine adapter.
 * Does not reimplement DocuSign auth.
 */

import { listLibraryDocumentsForEntity } from '@/lib/campaign/docusign/library';
import {
  queueSendEnvelope,
  type SendEnvelopeInput,
} from '@/lib/campaign/docusign-port';

export type DocuSignPort = {
  sendEnvelope(
    input: SendEnvelopeInput,
  ): Promise<{ ok: true; envelopeId: string } | { ok: false; error: string }>;
  listLibraryDocuments(
    entityId: string,
    q?: string,
  ): Promise<Array<{ id: string; title: string }>>;
};

/** Live port — queues ecc_envelope_actions; dispatch via /api/campaign/v1/docusign. */
export const spineDocuSignPort: DocuSignPort = {
  async sendEnvelope(input) {
    const result = await queueSendEnvelope({ ...input, queueOnly: true });
    if (!result.ok) return result;
    return {
      ok: true,
      envelopeId: result.envelopeIds?.[0] || result.actionIds[0] || 'queued',
    };
  },
  async listLibraryDocuments(entityId, q) {
    return listLibraryDocumentsForEntity(entityId, q);
  },
};
