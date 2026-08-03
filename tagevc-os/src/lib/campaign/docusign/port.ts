/**
 * Thin DocuSign port — Document Library is SoT; reuse spine adapter.
 * Does not reimplement DocuSign auth.
 */

export type SendEnvelopeInput = {
  entityId: string;
  libraryDocumentId: string;
  contactIds: string[];
  campaignId?: string | null;
  enrollmentId?: string | null;
  emailMessage?: string | null;
};

export type DocuSignPort = {
  sendEnvelope(
    input: SendEnvelopeInput,
  ): Promise<{ ok: true; envelopeId: string } | { ok: false; error: string }>;
  listLibraryDocuments(
    entityId: string,
    q?: string,
  ): Promise<Array<{ id: string; title: string }>>;
};

/** Stub port — wires to existing spine when library APIs are available. */
export const spineDocuSignPort: DocuSignPort = {
  async sendEnvelope(input) {
    // Existing spine DocuSign lives under /api/docusign + src/lib/docusign.
    // Campaign stores library_document_id only; actual send is delegated.
    if (!input.libraryDocumentId) {
      return { ok: false, error: 'library_document_id required' };
    }
    return {
      ok: false,
      error:
        'Use Shared Services → Legal → DocuSign library send; campaign enroll hooks call spine when envelope action is configured',
    };
  },
  async listLibraryDocuments(_entityId, _q) {
    return [];
  },
};
