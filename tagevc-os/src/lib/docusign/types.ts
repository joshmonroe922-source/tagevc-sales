/**
 * DocuSign domain types — Phase 20 architecture scaffolding.
 * No live API client yet; mock send/webhook remain in document-store.
 */

export type DocusignEnvelopeStatus =
  | 'created'
  | 'sent'
  | 'delivered'
  | 'signed'
  | 'completed'
  | 'declined'
  | 'voided'
  | 'error';

export type DocusignConnectEvent = {
  event_id: string;
  envelope_id: string;
  status: DocusignEnvelopeStatus;
  doc_id: string | null;
  entity_id: string | null;
  raw_payload: Record<string, unknown> | null;
  received_at: string;
};

export type DocusignSendRequest = {
  doc_id: string;
  entity_id: string | null;
  template_id?: string | null;
  signers: Array<{
    name: string;
    email: string;
    order: number;
    role: string;
  }>;
  /** Capital docs require human gate + action:docusign_capital */
  is_capital: boolean;
};

/** Env keys planned for Phase 21+ real integration (not required yet). */
export const DOCUSIGN_ENV_KEYS = [
  'DOCUSIGN_INTEGRATION_KEY',
  'DOCUSIGN_USER_ID',
  'DOCUSIGN_ACCOUNT_ID',
  'DOCUSIGN_PRIVATE_KEY',
  'DOCUSIGN_WEBHOOK_SECRET',
  'DOCUSIGN_BASE_PATH',
] as const;
