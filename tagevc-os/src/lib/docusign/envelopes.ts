/**
 * DocuSign envelope create + status (Phase 21).
 */

import { getDocuSignConfig, type DocuSignConfig } from './config';
import { getDocuSignAccessToken } from './jwt';

export type CreateEnvelopeInput = {
  emailSubject: string;
  documentName: string;
  /** Plain text or HTML converted to a simple text document */
  documentText: string;
  signers: Array<{ name: string; email: string; recipientId?: string }>;
  status?: 'sent' | 'created';
};

export type CreateEnvelopeResult = {
  envelopeId: string;
  status: string;
  raw: unknown;
};

async function docusignFetch(
  cfg: DocuSignConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getDocuSignAccessToken(cfg);
  const url = `${cfg.basePath}/restapi/v2.1/accounts/${cfg.accountId}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

function textToBase64Document(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

export async function createEnvelope(
  input: CreateEnvelopeInput,
): Promise<CreateEnvelopeResult> {
  const cfg = getDocuSignConfig();
  if (!cfg) throw new Error('DocuSign is not configured');

  const signers = input.signers
    .filter((s) => s.email?.trim())
    .map((s, i) => ({
      email: s.email.trim(),
      name: s.name.trim() || s.email.trim(),
      recipientId: s.recipientId ?? String(i + 1),
      routingOrder: '1',
      tabs: {
        signHereTabs: [
          {
            documentId: '1',
            pageNumber: '1',
            xPosition: '100',
            yPosition: '700',
          },
        ],
      },
    }));

  if (signers.length === 0) {
    throw new Error('At least one signer email is required for DocuSign');
  }

  const payload = {
    emailSubject: input.emailSubject.slice(0, 100),
    documents: [
      {
        documentBase64: textToBase64Document(
          input.documentText || input.documentName,
        ),
        name: input.documentName.slice(0, 100) || 'document.txt',
        fileExtension: 'txt',
        documentId: '1',
      },
    ],
    recipients: { signers },
    status: input.status ?? 'sent',
  };

  const res = await docusignFetch(cfg, '/envelopes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => ({}))) as {
    envelopeId?: string;
    status?: string;
    message?: string;
    errorCode?: string;
  };

  if (!res.ok || !json.envelopeId) {
    const detail =
      json.message || json.errorCode || `HTTP ${res.status}`;
    throw new Error(`DocuSign create envelope failed: ${detail}`);
  }

  return {
    envelopeId: json.envelopeId,
    status: json.status ?? 'sent',
    raw: json,
  };
}

export async function getEnvelopeStatus(envelopeId: string): Promise<{
  envelopeId: string;
  status: string;
  raw: unknown;
}> {
  const cfg = getDocuSignConfig();
  if (!cfg) throw new Error('DocuSign is not configured');

  const res = await docusignFetch(
    cfg,
    `/envelopes/${encodeURIComponent(envelopeId)}`,
  );
  const json = (await res.json().catch(() => ({}))) as {
    envelopeId?: string;
    status?: string;
    message?: string;
  };

  if (!res.ok) {
    throw new Error(
      `DocuSign get envelope failed: ${json.message || `HTTP ${res.status}`}`,
    );
  }

  return {
    envelopeId: json.envelopeId ?? envelopeId,
    status: (json.status ?? 'unknown').toLowerCase(),
    raw: json,
  };
}
