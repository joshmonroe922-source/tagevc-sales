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
  transactionId?: string;
  intentId?: string;
  entityId?: string | null;
  operationKind?: 'document_send' | 'template_send' | 'replacement';
  docId?: string | null;
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
    signal: init?.signal ?? AbortSignal.timeout(45_000),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

async function docusignError(
  operation: string,
  res: Response,
  json: { message?: string; errorCode?: string },
): Promise<string> {
  const trace =
    res.headers.get('x-docusign-tracetoken') ||
    res.headers.get('x-docusign-trace-token');
  const code = json.errorCode ? ` · ${json.errorCode}` : '';
  const tracePart = trace ? ` · trace ${trace}` : '';
  return `${operation} failed · HTTP ${res.status}${code} · ${
    json.message || res.statusText || 'Unknown DocuSign error'
  }${tracePart}`;
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
    ...(input.transactionId ? { transactionId: input.transactionId } : {}),
    ...(input.intentId
      ? {
          customFields: {
            textCustomFields: [
              {
                name: 'tagevc_send_intent_id',
                value: input.intentId,
                show: 'false',
              },
              {
                name: 'tagevc_entity_id',
                value: input.entityId ?? 'firm',
                show: 'false',
              },
              {
                name: 'tagevc_operation_kind',
                value: input.operationKind ?? 'document_send',
                show: 'false',
              },
              ...(input.docId
                ? [
                    {
                      name: 'tagevc_doc_id',
                      value: input.docId,
                      show: 'false',
                    },
                  ]
                : []),
            ],
          },
        }
      : {}),
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
    throw new Error(await docusignError('Create envelope', res, json));
  }

  return {
    envelopeId: json.envelopeId,
    status: json.status ?? 'sent',
    raw: json,
  };
}

export type CreateFromTemplateInput = {
  templateId: string;
  emailSubject: string;
  signers: Array<{
    email: string;
    name: string;
    roleName?: string;
  }>;
  status?: 'sent' | 'created';
  transactionId?: string;
  intentId?: string;
  entityId?: string | null;
  operationKind?: 'template_send' | 'replacement';
  docId?: string | null;
};

/** Send an envelope from a DocuSign template (Phase 27). */
export async function createEnvelopeFromTemplate(
  input: CreateFromTemplateInput,
): Promise<CreateEnvelopeResult> {
  const cfg = getDocuSignConfig();
  if (!cfg) throw new Error('DocuSign is not configured');

  const roles = input.signers
    .filter((s) => s.email?.trim())
    .map((s, i) => ({
      email: s.email.trim(),
      name: s.name.trim() || s.email.trim(),
      roleName: s.roleName?.trim() || (i === 0 ? 'Signer' : `Signer${i + 1}`),
    }));

  if (roles.length === 0) {
    throw new Error('At least one signer is required');
  }

  const payload = {
    emailSubject: input.emailSubject.slice(0, 100),
    templateId: input.templateId,
    templateRoles: roles,
    status: input.status ?? 'sent',
    ...(input.transactionId ? { transactionId: input.transactionId } : {}),
    ...(input.intentId
      ? {
          customFields: {
            textCustomFields: [
              {
                name: 'tagevc_send_intent_id',
                value: input.intentId,
                show: 'false',
              },
              {
                name: 'tagevc_entity_id',
                value: input.entityId ?? 'firm',
                show: 'false',
              },
              {
                name: 'tagevc_operation_kind',
                value: input.operationKind ?? 'template_send',
                show: 'false',
              },
            ],
          },
        }
      : {}),
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
    throw new Error(await docusignError('Template send', res, json));
  }

  return {
    envelopeId: json.envelopeId,
    status: json.status ?? 'sent',
    raw: json,
  };
}

export async function listEnvelopeStatusesByTransactionIds(
  transactionIds: string[],
): Promise<
  Array<{ transactionId: string; envelopeId: string; status: string }>
> {
  const cfg = getDocuSignConfig();
  if (!cfg) throw new Error('DocuSign is not configured');
  if (transactionIds.length === 0) return [];
  const res = await docusignFetch(cfg, '/envelopes/status', {
    method: 'POST',
    body: JSON.stringify({ transactionIds: transactionIds.slice(0, 20) }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    envelopes?: Array<{
      transactionId?: string;
      envelopeId?: string;
      status?: string;
    }>;
    message?: string;
    errorCode?: string;
  };
  if (!res.ok) {
    throw new Error(await docusignError('Transaction recovery', res, json));
  }
  return (json.envelopes ?? [])
    .filter(
      (
        envelope,
      ): envelope is {
        transactionId: string;
        envelopeId: string;
        status?: string;
      } => Boolean(envelope.transactionId && envelope.envelopeId),
    )
    .map((envelope) => ({
      transactionId: envelope.transactionId,
      envelopeId: envelope.envelopeId,
      status: envelope.status ?? 'sent',
    }));
}

export async function getEnvelopeRecoveryEvidence(
  envelopeId: string,
): Promise<Record<string, string>> {
  const cfg = getDocuSignConfig();
  if (!cfg) throw new Error('DocuSign is not configured');
  const res = await docusignFetch(
    cfg,
    `/envelopes/${encodeURIComponent(envelopeId)}/custom_fields`,
    { signal: AbortSignal.timeout(20_000) },
  );
  const json = (await res.json().catch(() => ({}))) as {
    textCustomFields?: Array<{ name?: string; value?: string }>;
    message?: string;
    errorCode?: string;
  };
  if (!res.ok) {
    throw new Error(await docusignError('Recovery evidence', res, json));
  }
  return Object.fromEntries(
    (json.textCustomFields ?? [])
      .filter(
        (field): field is { name: string; value: string } =>
          Boolean(field.name && field.value),
      )
      .map((field) => [field.name, field.value]),
  );
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
    errorCode?: string;
  };

  if (!res.ok) {
    throw new Error(await docusignError('Get envelope', res, json));
  }

  return {
    envelopeId: json.envelopeId ?? envelopeId,
    status: (json.status ?? 'unknown').toLowerCase(),
    raw: json,
  };
}

export type DocuSignEnvelopeSummary = {
  envelopeId: string;
  status: string;
  emailSubject: string | null;
  sentDateTime: string | null;
  completedDateTime: string | null;
  voidedDateTime: string | null;
  voidedReason: string | null;
  statusChangedDateTime: string | null;
  recipients: Array<{
    name: string | null;
    email: string | null;
    role: string;
    status: string;
    routingOrder: string | null;
  }>;
};

export type DocuSignPagination = {
  resultSetSize: number;
  totalSetSize: number;
  startPosition: number;
  endPosition: number;
  nextStartPosition: number | null;
  previousStartPosition: number | null;
};

function parsePagination(input: {
  resultSetSize?: string;
  totalSetSize?: string;
  startPosition?: string;
  endPosition?: string;
  nextUri?: string;
  previousUri?: string;
}): DocuSignPagination {
  const safe = (value?: string) => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };
  const startFromUri = (uri?: string): number | null => {
    if (!uri) return null;
    try {
      const parsed = new URL(uri, 'https://docusign.invalid');
      const n = Number(parsed.searchParams.get('start_position'));
      return Number.isInteger(n) && n >= 0 ? n : null;
    } catch {
      return null;
    }
  };
  return {
    resultSetSize: safe(input.resultSetSize),
    totalSetSize: safe(input.totalSetSize),
    startPosition: safe(input.startPosition),
    endPosition: safe(input.endPosition),
    nextStartPosition: startFromUri(input.nextUri),
    previousStartPosition: startFromUri(input.previousUri),
  };
}

/** Authoritative recent account envelopes for the management hub (Phase 31). */
export async function listRecentEnvelopes(opts?: {
  status?: string;
  count?: number;
  days?: number;
  startPosition?: number;
}): Promise<
  | {
      ok: true;
      envelopes: DocuSignEnvelopeSummary[];
      pagination: DocuSignPagination;
    }
  | { ok: false; error: string }
> {
  const cfg = getDocuSignConfig();
  if (!cfg) return { ok: false, error: 'DocuSign is not configured' };
  try {
    const from = new Date();
    from.setUTCDate(
      from.getUTCDate() - Math.min(Math.max(opts?.days ?? 30, 1), 90),
    );
    const params = new URLSearchParams({
      from_date: from.toISOString(),
      count: String(Math.min(opts?.count ?? 40, 100)),
      include: 'recipients',
      start_position: String(
        Math.max(0, Math.floor(opts?.startPosition ?? 0)),
      ),
    });
    if (opts?.status?.trim()) {
      params.set('status', opts.status.trim().toLowerCase());
    }
    const res = await docusignFetch(
      cfg,
      `/envelopes?${params.toString()}`,
    );
    const json = (await res.json().catch(() => ({}))) as {
      envelopes?: Array<Record<string, unknown>>;
      message?: string;
      errorCode?: string;
      resultSetSize?: string;
      totalSetSize?: string;
      startPosition?: string;
      endPosition?: string;
      nextUri?: string;
      previousUri?: string;
    };
    if (!res.ok) {
      return { ok: false, error: await docusignError('Envelope list', res, json) };
    }
    return {
      ok: true,
      envelopes: (json.envelopes ?? []).map((e) => {
        const recipientRoot =
          (e.recipients as Record<string, unknown[]> | undefined) ?? {};
        const recipients = Object.entries(recipientRoot).flatMap(
          ([role, rows]) =>
            (Array.isArray(rows) ? rows : []).map((value) => {
              const recipient = value as Record<string, unknown>;
              return {
                name: (recipient.name as string) ?? null,
                email: (recipient.email as string) ?? null,
                role,
                status: String(recipient.status ?? 'unknown').toLowerCase(),
                routingOrder: (recipient.routingOrder as string) ?? null,
              };
            }),
        );
        return {
          envelopeId: String(e.envelopeId ?? ''),
          status: String(e.status ?? 'unknown').toLowerCase(),
          emailSubject: (e.emailSubject as string) ?? null,
          sentDateTime: (e.sentDateTime as string) ?? null,
          completedDateTime: (e.completedDateTime as string) ?? null,
          voidedDateTime: (e.voidedDateTime as string) ?? null,
          voidedReason: (e.voidedReason as string) ?? null,
          statusChangedDateTime: (e.statusChangedDateTime as string) ?? null,
          recipients,
        };
      }),
      pagination: parsePagination(json),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Envelope list failed',
    };
  }
}

/** Void a live envelope (Phase 25). Mock ENV- ids are local-only. */
export async function voidEnvelope(
  envelopeId: string,
  reason: string,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  if (envelopeId.startsWith('ENV-')) {
    return { ok: true, status: 'voided' };
  }
  const cfg = getDocuSignConfig();
  if (!cfg) return { ok: false, error: 'DocuSign is not configured' };

  try {
    const res = await docusignFetch(
      cfg,
      `/envelopes/${encodeURIComponent(envelopeId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          status: 'voided',
          voidedReason: (reason || 'Voided via Tage VC OS').slice(0, 200),
        }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      message?: string;
      errorCode?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: await docusignError('Void envelope', res, json),
      };
    }
    return { ok: true, status: 'voided' };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'void failed',
    };
  }
}

/** Resend notifications / remind pending signers (Phase 26). */
export async function remindEnvelope(
  envelopeId: string,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  if (envelopeId.startsWith('ENV-')) {
    return { ok: true, status: 'reminded' };
  }
  const cfg = getDocuSignConfig();
  if (!cfg) return { ok: false, error: 'DocuSign is not configured' };

  try {
    const res = await docusignFetch(
      cfg,
      `/envelopes/${encodeURIComponent(envelopeId)}?resend_envelope=true`,
      {
        method: 'PUT',
        body: JSON.stringify({}),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      message?: string;
      errorCode?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: await docusignError('Remind envelope', res, json),
      };
    }
    return { ok: true, status: 'reminded' };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'remind failed',
    };
  }
}

/** List account templates from DocuSign API. */
export async function listDocuSignTemplatesFromApi(opts?: {
  count?: number;
  startPosition?: number;
  searchText?: string;
}): Promise<
  | {
      ok: true;
      templates: Array<{
        templateId: string;
        name: string;
        description?: string;
        shared?: boolean;
        lastModified?: string;
        raw: unknown;
      }>;
      pagination: DocuSignPagination;
    }
  | { ok: false; error: string }
> {
  const cfg = getDocuSignConfig();
  if (!cfg) return { ok: false, error: 'DocuSign is not configured' };

  try {
    const count = Math.min(Math.max(opts?.count ?? 40, 1), 2000);
    const params = new URLSearchParams({
      count: String(count),
      include: 'recipients',
      start_position: String(
        Math.max(0, Math.floor(opts?.startPosition ?? 0)),
      ),
    });
    if (opts?.searchText?.trim()) {
      params.set('search_text', opts.searchText.trim().slice(0, 48));
    }
    const res = await docusignFetch(
      cfg,
      `/templates?${params.toString()}`,
    );
    const json = (await res.json().catch(() => ({}))) as {
      envelopeTemplates?: Array<{
        templateId?: string;
        name?: string;
        description?: string;
        shared?: boolean | string;
        lastModified?: string;
        recipients?: unknown;
        roles?: unknown;
      }>;
      message?: string;
      errorCode?: string;
      resultSetSize?: string;
      totalSetSize?: string;
      startPosition?: string;
      endPosition?: string;
      nextUri?: string;
      previousUri?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: await docusignError('Template list', res, json),
      };
    }
    const templates = (json.envelopeTemplates ?? [])
      .filter((t) => t.templateId)
      .map((t) => ({
        templateId: String(t.templateId),
        name: t.name || t.templateId || 'Untitled',
        description: t.description,
        shared: t.shared === true || t.shared === 'true',
        lastModified: t.lastModified,
        raw: t,
      }));
    return { ok: true, templates, pagination: parsePagination(json) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'list templates failed',
    };
  }
}

/** Fetch a single template with recipients from DocuSign API (Phase 29). */
export async function getDocuSignTemplateFromApi(
  templateId: string,
): Promise<
  | {
      ok: true;
      template: {
        templateId: string;
        name: string;
        description?: string;
        shared?: boolean;
        lastModified?: string;
        raw: unknown;
      };
    }
  | { ok: false; error: string }
> {
  const cfg = getDocuSignConfig();
  if (!cfg) return { ok: false, error: 'DocuSign is not configured' };
  const id = templateId.trim();
  if (!id) return { ok: false, error: 'templateId required' };

  try {
    const res = await docusignFetch(
      cfg,
      `/templates/${encodeURIComponent(id)}?include=recipients`,
    );
    const json = (await res.json().catch(() => ({}))) as {
      templateId?: string;
      name?: string;
      description?: string;
      shared?: boolean | string;
      lastModified?: string;
      recipients?: unknown;
      message?: string;
    };
    if (!res.ok || !json.templateId) {
      return {
        ok: false,
        error: json.message || `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      template: {
        templateId: String(json.templateId),
        name: json.name || json.templateId,
        description: json.description,
        shared: json.shared === true || json.shared === 'true',
        lastModified: json.lastModified,
        raw: json,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'get template failed',
    };
  }
}

/** Download Certificate of Completion PDF bytes (live envelopes). */
export async function downloadCertificateOfCompletion(
  envelopeId: string,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  if (envelopeId.startsWith('ENV-')) {
    const text = `Certificate of Completion (mock)\nEnvelope ${envelopeId}\n`;
    return { ok: true, buffer: Buffer.from(text, 'utf8') };
  }
  const cfg = getDocuSignConfig();
  if (!cfg) return { ok: false, error: 'DocuSign is not configured' };

  try {
    const token = await getDocuSignAccessToken(cfg);
    const url = `${cfg.basePath}/restapi/v2.1/accounts/${cfg.accountId}/envelopes/${encodeURIComponent(envelopeId)}/documents/certificate`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/pdf',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `CoC download HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true, buffer: Buffer.from(await res.arrayBuffer()) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'CoC download failed',
    };
  }
}
