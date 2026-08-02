/**
 * Microsoft Graph sendMail helper for platform email.
 * Callers supply a delegated access token (per-user mailbox OAuth).
 * Pattern lifted from My Recruiting Desk (`Recruiting Tools` → microsoft/graph.ts).
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export type GraphMailAttachment = {
  fileName: string;
  contentType: string;
  contentBase64: string;
};

export type GraphSendMailInput = {
  accessToken: string;
  subject: string;
  bodyHtml: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  saveToSentItems?: boolean;
  attachments?: GraphMailAttachment[];
};

function asGraphRecipients(emails: string[] | undefined) {
  return (emails ?? [])
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

/** Send HTML mail from the connected mailbox via Graph `/me/sendMail`. */
export async function sendGraphMail(input: GraphSendMailInput): Promise<void> {
  const toRecipients = asGraphRecipients(input.to);
  if (!toRecipients.length) {
    throw new Error('At least one To recipient is required');
  }

  const attachments = (input.attachments ?? [])
    .filter((a) => a.contentBase64 && a.fileName)
    .map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.fileName,
      contentType: a.contentType || 'application/octet-stream',
      contentBytes: a.contentBase64,
    }));

  const ccRecipients = asGraphRecipients(input.cc);
  const bccRecipients = asGraphRecipients(input.bcc);

  const res = await fetch(`${GRAPH_BASE}/me/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: input.subject.trim() || '(no subject)',
        body: { contentType: 'HTML', content: input.bodyHtml },
        toRecipients,
        ...(ccRecipients.length ? { ccRecipients } : {}),
        ...(bccRecipients.length ? { bccRecipients } : {}),
        ...(attachments.length ? { attachments } : {}),
      },
      saveToSentItems: input.saveToSentItems !== false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph sendMail failed: ${res.status} ${text}`);
  }
}

export type GraphSendAsUserInput = GraphSendMailInput & {
  /** Mailbox UPN or id (shared mailbox / host with send-as alias). */
  userUpn: string;
  /** Optional Reply-To address. */
  replyTo?: string | null;
  /** Optional From override (alias) — must have send-as permission. */
  fromAddress?: string | null;
};

/**
 * Send as a specific mailbox via Graph `/users/{upn}/sendMail`.
 * Use for shared mailboxes or host mailbox + From alias.
 */
export async function sendGraphMailAsUser(
  input: GraphSendAsUserInput,
): Promise<void> {
  const toRecipients = asGraphRecipients(input.to);
  if (!toRecipients.length) {
    throw new Error('At least one To recipient is required');
  }
  const upn = input.userUpn.trim();
  if (!upn) throw new Error('userUpn required for send-as');

  const attachments = (input.attachments ?? [])
    .filter((a) => a.contentBase64 && a.fileName)
    .map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.fileName,
      contentType: a.contentType || 'application/octet-stream',
      contentBytes: a.contentBase64,
    }));

  const replyTo = input.replyTo?.trim()
    ? asGraphRecipients([input.replyTo])
    : [];
  const from = input.fromAddress?.trim();

  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(upn)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: input.subject.trim() || '(no subject)',
          body: { contentType: 'HTML', content: input.bodyHtml },
          toRecipients,
          ...(replyTo.length ? { replyTo } : {}),
          ...(from
            ? { from: { emailAddress: { address: from.toLowerCase() } } }
            : {}),
          ...(attachments.length ? { attachments } : {}),
        },
        saveToSentItems: input.saveToSentItems !== false,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph sendMailAsUser failed: ${res.status} ${text}`);
  }
}

/** Opaque tracking token for open/click pixels (32 hex chars). */
export function newPlatformEmailTrackingToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
