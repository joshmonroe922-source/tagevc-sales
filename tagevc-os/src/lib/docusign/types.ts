/**
 * DocuSign domain types — Phase 21 live JWT + Connect.
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
  deal_id?: string | null;
  ticket_id?: string | null;
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

/** Env keys for live DocuSign JWT + Connect. */
export const DOCUSIGN_ENV_KEYS = [
  'DOCUSIGN_INTEGRATION_KEY',
  'DOCUSIGN_USER_ID',
  'DOCUSIGN_ACCOUNT_ID',
  'DOCUSIGN_PRIVATE_KEY',
  'DOCUSIGN_OAUTH_HOST',
  'DOCUSIGN_BASE_PATH',
  'DOCUSIGN_WEBHOOK_SECRET',
  'DOCUSIGN_CONNECT_HMAC_SECRET',
] as const;
